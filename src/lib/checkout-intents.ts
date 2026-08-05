import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchOptOutToken, fetchSuppressedEmails } from "@/lib/email-optout";
import { sendAbandonedCartEmail } from "@/lib/email";

type IntentItem = { name: string; quantity: number };

/**
 * Record or refresh a checkout intent for an email, the cart contents at the
 * moment the customer entered their email. Prior un-reminded or un-converted
 * intents for the same email are cleared so we keep just the latest.
 */
export async function recordIntent(
  email: string,
  items: IntentItem[],
  subtotalCents: number,
): Promise<void> {
  const supabase = createAdminClient();
  const normalized = email.trim().toLowerCase();
  await supabase
    .from("checkout_intents")
    .delete()
    .eq("email", normalized)
    .is("reminded_at", null)
    .is("converted_order_id", null);
  const { error } = await supabase.from("checkout_intents").insert({
    email: normalized,
    items,
    subtotal_cents: subtotalCents,
  });
  if (error) console.error("[abandoned-cart] record failed:", error.message);
}

/** Mark an email's open intent converted, called when an order is placed. */
export async function markConverted(email: string): Promise<void> {
  const supabase = createAdminClient();
  await supabase
    .from("checkout_intents")
    .update({ reminded_at: new Date().toISOString() })
    .eq("email", email.trim().toLowerCase())
    .is("reminded_at", null);
  // Stamping reminded_at on conversion prevents a later reminder. We don't have
  // the order id here, so converted_order_id stays null and the intent is closed.
}

/**
 * Email customers who started checkout `afterHours` ago and never went on to
 * order. Sends one reminder per intent and stamps reminded_at. Best-effort.
 */
export async function sendAbandonedReminders(afterHours: number): Promise<number> {
  const supabase = createAdminClient();
  const cutoff = new Date(Date.now() - afterHours * 3_600_000).toISOString();
  const { data } = await supabase
    .from("checkout_intents")
    .select("id, email, items, created_at")
    .is("reminded_at", null)
    .is("converted_order_id", null)
    .lt("created_at", cutoff);
  const intents =
    (data as { id: string; email: string; items: IntentItem[]; created_at: string }[] | null) ??
    [];
  if (intents.length === 0) return 0;

  // This is marketing, so anyone who asked to stop is skipped. One query for the
  // whole run rather than a check per abandoned cart.
  const suppressed = await fetchSuppressedEmails(intents.map((i) => i.email));

  // When each customer last ordered, so someone who did go on to buy is never
  // nagged. Payment is not the test here: a PayNow transfer is marked paid by
  // hand days after the order, so a real order sits at `pending` for most of its
  // life and keying on paid mailed customers who had already bought. Anything not
  // cancelled counts, which also covers the orders Michelle keys in from a
  // WhatsApp chat, since those never run the checkout path that closes an intent.
  // One query for the whole run, from the oldest cart in it, and the addresses
  // are matched lowercased in JS because an order keeps the address as the
  // customer typed it while an intent stores it normalized.
  const oldestCartMs = intents.reduce(
    (oldest, intent) => Math.min(oldest, new Date(intent.created_at).getTime()),
    Infinity,
  );
  const { data: orderRows } = await supabase
    .from("orders")
    .select("email, created_at")
    .neq("status", "cancelled")
    .gte("created_at", new Date(oldestCartMs).toISOString());
  const lastOrderedMs = new Map<string, number>();
  for (const row of (orderRows as { email: string; created_at: string }[] | null) ?? []) {
    const key = row.email.trim().toLowerCase();
    const placedMs = new Date(row.created_at).getTime();
    if (placedMs > (lastOrderedMs.get(key) ?? 0)) lastOrderedMs.set(key, placedMs);
  }

  let sent = 0;
  for (const intent of intents) {
    // An opted-out address is closed off rather than left open, or the same cart
    // would be reconsidered on every run forever.
    if (suppressed.has(intent.email.trim().toLowerCase())) {
      await supabase
        .from("checkout_intents")
        .update({ reminded_at: new Date().toISOString() })
        .eq("id", intent.id);
      continue;
    }
    // Skip if an order arrived for this email since the cart was started.
    const orderedMs = lastOrderedMs.get(intent.email.trim().toLowerCase()) ?? 0;
    if (orderedMs >= new Date(intent.created_at).getTime()) {
      await supabase
        .from("checkout_intents")
        .update({ reminded_at: new Date().toISOString() })
        .eq("id", intent.id);
      continue;
    }
    // Only close the intent when the reminder actually went out. Stamping
    // regardless meant a provider failure quietly consumed the one reminder
    // this cart was ever going to get.
    // No footer link means no lawful marketing send, so leave the intent open
    // for the next run rather than mailing without a way out.
    const optOutToken = await fetchOptOutToken(intent.email);
    if (!optOutToken) continue;
    const delivered = await sendAbandonedCartEmail(intent.email, intent.items ?? [], optOutToken);
    if (!delivered) continue;
    await supabase
      .from("checkout_intents")
      .update({ reminded_at: new Date().toISOString() })
      .eq("id", intent.id);
    sent += 1;
  }
  return sent;
}
