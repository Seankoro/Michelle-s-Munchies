"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { rateLimit } from "@/lib/rate-limit";
import { fetchStoreSettings } from "@/lib/settings";
import { sendGiftScheduledEmail } from "@/lib/email";
import { resolveDeliveryFeeCents } from "@/lib/delivery-pricing";
import { isChangeable, type DeliveryAddress } from "@/lib/order";

export type GiftScheduleResult = { ok: true } | { ok: false; error: string };

/**
 * The gift recipient fills in their own delivery address and time window from
 * the shared link. Auth is possession of the 32-char recipient token. Re-checks
 * the per-window cap on the buyer's chosen date, only while the order is still
 * early, and emails the owner so she has the address. Rate-limited.
 *
 * The gifting feature flag is deliberately not checked here. It only stops new
 * gift purchases at checkout. A gift that is already bought and sent still needs
 * somewhere to go, so switching gifting off must not strand it.
 */
export async function scheduleGiftAction(
  token: string,
  address: { line1: string; unit: string; postalCode: string },
  timeWindow: string,
): Promise<GiftScheduleResult> {
  if (!(await rateLimit("gift-schedule", { limit: 15, windowMs: 5 * 60_000 }))) {
    return { ok: false, error: "Too many changes. Please wait a few minutes." };
  }
  const settings = await fetchStoreSettings();

  const line1 = address.line1.trim();
  const unit = address.unit?.trim() ?? "";
  const postal = address.postalCode.trim();
  // The other two writers of this column cap their text. This one did not, so a
  // gift link, which anyone can mint by placing their own self-scheduled gift
  // order, was an uncapped write into an order the admin panel loads in full.
  // The same caps the owner's own address control uses.
  if (line1.length > 200 || unit.length > 60) {
    return { ok: false, error: "That address is too long. Please shorten it." };
  }
  if (!line1 || !/^\d{6}$/.test(postal)) {
    return { ok: false, error: "Enter your address and a 6-digit postal code." };
  }
  if (!timeWindow || !settings.timeWindows.includes(timeWindow)) {
    return { ok: false, error: "Please choose a time that works for you." };
  }

  const admin = createAdminClient();
  const { data } = await admin
    .from("orders")
    .select(
      "id, status, payment_status, subtotal_cents, discount_cents, scheduled_date, order_number, recipient_name, recipient_scheduled_at",
    )
    .eq("recipient_token", token)
    .maybeSingle();
  const order = data as {
    id: string;
    status: string;
    payment_status: string;
    subtotal_cents: number;
    discount_cents: number;
    scheduled_date: string;
    order_number: string;
    recipient_name: string | null;
    recipient_scheduled_at: string | null;
  } | null;
  if (!order) return { ok: false, error: "This gift link is not valid." };
  if (!isChangeable(order.status)) {
    return { ok: false, error: "This gift is already being prepared and can’t be changed." };
  }
  // The link is a write credential for somebody else's paid order, and it is
  // meant to be passed along, so it can easily end up in a group chat or a
  // forwarded message. Left open it would let anyone who sees it redirect the
  // delivery to their own address, quietly and repeatedly. It answers the
  // question once; changing an answer afterwards goes through Michelle, the
  // same rule the customer's own reschedule already follows.
  if (order.recipient_scheduled_at) {
    return {
      ok: false,
      error:
        "These details have already been filled in. To change them, please message us on WhatsApp.",
    };
  }

  // Per-window cap re-checked on the gift's date, excluding this order's own row.
  if (settings.perWindowCap && settings.perWindowCap > 0) {
    const { count } = await admin
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("scheduled_date", order.scheduled_date)
      .eq("time_window", timeWindow)
      .neq("status", "cancelled")
      .neq("id", order.id);
    if ((count ?? 0) >= settings.perWindowCap) {
      return { ok: false, error: "That time is full. Please pick another." };
    }
  }

  const deliveryAddress: DeliveryAddress = {
    line1,
    unit: address.unit.trim() || undefined,
    postalCode: postal,
  };
  // Now that the recipient's address is known, price delivery by distance like a
  // normal delivery order, unless the buyer already paid (a Stripe-prepaid gift,
  // where the charged total is fixed). The usual PayNow flow is still unpaid here,
  // so the owner collects the correct amount.
  const updates: Record<string, unknown> = {
    delivery_address: deliveryAddress,
    time_window: timeWindow,
    recipient_scheduled_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (order.payment_status !== "paid") {
    const feeCents = await resolveDeliveryFeeCents("delivery", order.subtotal_cents, postal, settings);
    updates.delivery_fee_cents = feeCents;
    updates.total_cents = Math.max(0, order.subtotal_cents + feeCents - order.discount_cents);
  }
  const { error } = await admin.from("orders").update(updates).eq("id", order.id);
  if (error) return { ok: false, error: "Couldn’t save your details. Please try again." };

  await sendGiftScheduledEmail(order.order_number, order.recipient_name, deliveryAddress, timeWindow);
  return { ok: true };
}
