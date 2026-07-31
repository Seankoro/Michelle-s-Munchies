import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchStoreSettings } from "@/lib/settings";
import { EARLY_STATUSES } from "@/lib/order";
import { sendGiftScheduleReminderEmail } from "@/lib/email";
import { singaporeDateString } from "@/lib/time";

/** Cap per run so a first pass over a backlog can't fan out unbounded email. */
const MAX_PER_RUN = 50;
const DAY_MS = 24 * 60 * 60 * 1000;


/** The fields the chase needs. recipient_token is non-null by the query below. */
type UnscheduledGiftRow = {
  id: string;
  order_number: string;
  customer_name: string;
  email: string;
  recipient_name: string | null;
  recipient_token: string;
  scheduled_date: string;
};

/**
 * Email the buyer when a gift they left for the recipient to schedule still has
 * no delivery address and no time window, and its date is close.
 *
 * A gift bought with "let the recipient pick" stores no address and an empty
 * window on purpose, and the recipient's link is only ever shown on the buyer's
 * own tracking page. If it never gets passed on, or gets ignored, nothing in the
 * system asks again: the order reaches its date with nowhere to send it and
 * Michelle finds out from a packing slip with a blank address on the morning.
 *
 * The buyer is chased rather than the recipient, because the buyer's email is the
 * address we hold, they can nudge the recipient themselves, and they can fill the
 * details in if they already know where the box should go.
 *
 * This is a fulfilment email, not marketing, so the opt-out list is not
 * consulted, and the gifting feature flag is not checked either. That flag only
 * stops new gift purchases at checkout, the same reason the recipient's own page
 * ignores it: switching gifting off must not strand a gift already bought.
 *
 * Returns how many buyers were chased.
 */
export async function remindUnscheduledGifts(): Promise<number> {
  const admin = createAdminClient();
  const settings = await fetchStoreSettings();
  const today = singaporeDateString();
  // The lead time is the span Michelle shops and bakes in, so a date inside it is
  // the last point where a nudge can still change the outcome. Today counts,
  // because the packing slip prints that morning. Dates already gone do not: no
  // address saves a bake that has happened, and the orders list flags those
  // separately. Singapore never shifts its clocks, so stepping forward whole
  // 24-hour spans and reading the date in SGT lands on the right day at any hour.
  const horizon = singaporeDateString(Date.now() + settings.leadTimeDays * DAY_MS);

  const { data, error } = await admin
    .from("orders")
    .select(
      "id, order_number, customer_name, email, recipient_name, recipient_token, scheduled_date",
    )
    .eq("is_gift", true)
    .not("recipient_token", "is", null)
    .is("recipient_scheduled_at", null)
    // Chase once. A stamp of its own rather than a marker in owner_note, because
    // the stale-order sweep treats an owner_note (and a moved updated_at) as
    // proof a human was involved and then refuses to touch the order, so writing
    // the reminder there made an abandoned unpaid gift immune to cleanup and it
    // held its promo slot and reserved points for good.
    .is("gift_reminder_sent_at", null)
    // Narrower than "not cancelled" on purpose. Past `confirmed` the recipient's
    // own form is refused by scheduleGiftAction, so a nudge would hand the buyer
    // a link that can only turn them away.
    .in("status", EARLY_STATUSES)
    .gte("scheduled_date", today)
    .lte("scheduled_date", horizon);
  if (error) throw new Error(`Failed to find unscheduled gifts: ${error.message}`);

  let chased = 0;
  for (const row of (data as UnscheduledGiftRow[] | null) ?? []) {
    if (chased >= MAX_PER_RUN) break;
    // The stamp is written before the send and is what claims the order: it also
    // re-checks that the recipient has not filled the details in since the read,
    // and only an unstamped row is claimed, so a concurrent run cannot chase the
    // same buyer twice. Deliberately does NOT touch updated_at, which the stale
    // order sweep reads as "a human has been here".
    const { data: claim, error: stampError } = await admin
      .from("orders")
      .update({ gift_reminder_sent_at: new Date().toISOString() })
      .eq("id", row.id)
      .is("recipient_scheduled_at", null)
      .is("gift_reminder_sent_at", null)
      .select("id")
      .maybeSingle();
    if (stampError) throw new Error(`Failed to record the gift reminder: ${stampError.message}`);
    if (!claim) continue;

    // The senders report failure rather than throwing, so a false here is the
    // only signal that nothing reached the buyer. Hand the claim back when that
    // happens, or the one chase this gift was ever going to get is silently
    // spent on an email that was never delivered.
    const delivered = await sendGiftScheduleReminderEmail({
      to: row.email,
      buyerName: row.customer_name,
      recipientName: row.recipient_name,
      orderNumber: row.order_number,
      scheduledDate: row.scheduled_date,
      recipientToken: row.recipient_token,
    });
    if (!delivered) {
      console.error(`[gift-reminder] send failed for ${row.order_number}, releasing the claim`);
      await admin
        .from("orders")
        .update({ gift_reminder_sent_at: null })
        .eq("id", row.id);
      continue;
    }
    chased += 1;
  }
  return chased;
}
