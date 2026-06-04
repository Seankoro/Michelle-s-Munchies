"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { rateLimit } from "@/lib/rate-limit";
import { fetchStoreSettings } from "@/lib/settings";
import { earliestFulfillmentDate } from "@/lib/order";
import { sendCancellationRequestEmail } from "@/lib/email";

export type LookupResult = { ok: true; token: string } | { ok: false; error: string };
export type ChangeResult = { ok: true } | { ok: false; error: string };

const MAX_RESCHEDULES = 3;
const CHANGEABLE_STATUSES = ["received", "confirmed"];

/**
 * Self-serve reschedule from the tracking link. Auth = possession of the 32-char
 * tracking token. Re-validates lead time, cutoff, blackout, and the per-window
 * and daily caps server-side while excluding this order's own slot, only while
 * the order is still early, capped at MAX_RESCHEDULES, rate-limited.
 */
export async function rescheduleOrderAction(
  token: string,
  newDate: string,
  newWindow: string,
): Promise<ChangeResult> {
  if (!(await rateLimit("reschedule", { limit: 10, windowMs: 5 * 60_000 }))) {
    return { ok: false, error: "Too many changes. Please wait a few minutes." };
  }
  const settings = await fetchStoreSettings();
  if (!settings.features.orderChanges) {
    return { ok: false, error: "Order changes aren’t available right now." };
  }

  const admin = createAdminClient();
  const { data } = await admin
    .from("orders")
    .select("id, status, reschedule_count")
    .eq("tracking_token", token)
    .maybeSingle();
  const order = data as { id: string; status: string; reschedule_count: number } | null;
  if (!order) return { ok: false, error: "Order not found." };
  if (!CHANGEABLE_STATUSES.includes(order.status)) {
    return { ok: false, error: "This order is already being prepared and can’t be changed." };
  }
  if (order.reschedule_count >= MAX_RESCHEDULES) {
    return { ok: false, error: "This order has been rescheduled too many times. Please message us." };
  }

  // Re-validate the new slot exactly like checkout.
  const earliest = earliestFulfillmentDate(settings.leadTimeDays, new Date(), settings.dailyCutoffTime);
  if (!newDate || newDate < earliest) {
    return { ok: false, error: "Please choose a later date." };
  }
  if (settings.blackoutDates.includes(newDate)) {
    return { ok: false, error: "We’re away that day. Please choose another." };
  }
  if (!newWindow || !settings.timeWindows.includes(newWindow)) {
    return { ok: false, error: "Please choose a valid time window." };
  }
  // Caps recounted on the NEW date, excluding this order's own row.
  if (settings.dailyOrderCap && settings.dailyOrderCap > 0) {
    const { count } = await admin
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("scheduled_date", newDate)
      .neq("status", "cancelled")
      .neq("id", order.id);
    if ((count ?? 0) >= settings.dailyOrderCap) {
      return { ok: false, error: "That date is fully booked. Please pick another." };
    }
  }
  if (settings.perWindowCap && settings.perWindowCap > 0) {
    const { count } = await admin
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("scheduled_date", newDate)
      .eq("time_window", newWindow)
      .neq("status", "cancelled")
      .neq("id", order.id);
    if ((count ?? 0) >= settings.perWindowCap) {
      return { ok: false, error: "That time slot is full. Please pick another window." };
    }
  }

  const { error } = await admin
    .from("orders")
    .update({
      scheduled_date: newDate,
      time_window: newWindow,
      reschedule_count: order.reschedule_count + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", order.id);
  if (error) return { ok: false, error: "Couldn’t update the order. Please try again." };
  return { ok: true };
}

/** Customer asks to cancel, emails the owner. The admin does the actual cancel and refund. */
export async function requestCancellationAction(token: string): Promise<ChangeResult> {
  if (!(await rateLimit("cancel-request", { limit: 10, windowMs: 5 * 60_000 }))) {
    return { ok: false, error: "Too many requests. Please wait a few minutes." };
  }
  if (!(await fetchStoreSettings()).features.orderChanges) {
    return { ok: false, error: "Order changes aren’t available right now." };
  }
  const admin = createAdminClient();
  const { data } = await admin
    .from("orders")
    .select("order_number, customer_name")
    .eq("tracking_token", token)
    .maybeSingle();
  const order = data as { order_number: string; customer_name: string } | null;
  if (!order) return { ok: false, error: "Order not found." };
  await sendCancellationRequestEmail(order.order_number, order.customer_name);
  return { ok: true };
}

/**
 * Guest order lookup. Find a past order by email and order number and return its
 * tracking token. Both must match, with email acting as the lightweight auth.
 * We keep the error generic so it can't be used to probe which orders exist.
 */
export async function findGuestOrder(email: string, orderNumber: string): Promise<LookupResult> {
  const num = orderNumber.trim().toUpperCase();
  const mail = email.trim().toLowerCase();
  if (!num || !mail) return { ok: false, error: "Enter your email and order number." };

  // Throttle to deter order-number guessing.
  if (!(await rateLimit("order-lookup", { limit: 10, windowMs: 5 * 60_000 }))) {
    return { ok: false, error: "Too many attempts. Please wait a few minutes and try again." };
  }

  const admin = createAdminClient();
  const { data } = await admin
    .from("orders")
    .select("email, tracking_token")
    .eq("order_number", num)
    .maybeSingle();
  const row = data as { email: string; tracking_token: string } | null;

  if (!row || row.email.trim().toLowerCase() !== mail) {
    return { ok: false, error: "We couldn’t find an order with that email and number." };
  }
  return { ok: true, token: row.tracking_token };
}
