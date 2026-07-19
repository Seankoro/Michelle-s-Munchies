"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { rateLimit } from "@/lib/rate-limit";
import { fetchStoreSettings } from "@/lib/settings";
import { sendGiftScheduledEmail } from "@/lib/email";
import { isChangeable, type DeliveryAddress } from "@/lib/order";

export type GiftScheduleResult = { ok: true } | { ok: false; error: string };

/**
 * The gift recipient fills in their own delivery address and time window from
 * the shared link. Auth is possession of the 32-char recipient token. Re-checks
 * the per-window cap on the buyer's chosen date, only while the order is still
 * early, and emails the owner so she has the address. Rate-limited.
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
  if (!settings.features.gifting) {
    return { ok: false, error: "This gift link isn’t available right now." };
  }

  const line1 = address.line1.trim();
  const postal = address.postalCode.trim();
  if (!line1 || !/^\d{6}$/.test(postal)) {
    return { ok: false, error: "Enter your address and a 6-digit postal code." };
  }
  if (!timeWindow || !settings.timeWindows.includes(timeWindow)) {
    return { ok: false, error: "Please choose a time that works for you." };
  }

  const admin = createAdminClient();
  const { data } = await admin
    .from("orders")
    .select("id, status, scheduled_date, order_number, recipient_name")
    .eq("recipient_token", token)
    .maybeSingle();
  const order = data as {
    id: string;
    status: string;
    scheduled_date: string;
    order_number: string;
    recipient_name: string | null;
  } | null;
  if (!order) return { ok: false, error: "This gift link is not valid." };
  if (!isChangeable(order.status)) {
    return { ok: false, error: "This gift is already being prepared and can’t be changed." };
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
  const { error } = await admin
    .from("orders")
    .update({
      delivery_address: deliveryAddress,
      time_window: timeWindow,
      recipient_scheduled_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", order.id);
  if (error) return { ok: false, error: "Couldn’t save your details. Please try again." };

  await sendGiftScheduledEmail(order.order_number, order.recipient_name, deliveryAddress, timeWindow);
  return { ok: true };
}
