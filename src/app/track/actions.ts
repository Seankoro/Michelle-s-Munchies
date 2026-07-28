"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { rateLimit } from "@/lib/rate-limit";
import { fetchStoreSettings } from "@/lib/settings";
import { earliestFulfillmentDate, isChangeable } from "@/lib/order";
import { singaporeNow } from "@/lib/time";
import { sendCancellationRequestEmail, sendItemsAddedEmail } from "@/lib/email";
import { reorderFromOrderId, type ReorderResult } from "@/lib/cart-resolve";
import { fetchProducts } from "@/lib/products";
import type { SelectedOption } from "@/lib/types";

export type LookupResult = { ok: true; token: string } | { ok: false; error: string };
export type ChangeResult = { ok: true } | { ok: false; error: string };
export type AddItemsResult = { ok: true; addedCents: number } | { ok: false; error: string };

const MAX_RESCHEDULES = 3;

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
  if (!isChangeable(order.status)) {
    return { ok: false, error: "This order is already being prepared and can’t be changed." };
  }
  if (order.reschedule_count >= MAX_RESCHEDULES) {
    return { ok: false, error: "This order has been rescheduled too many times. Please message us." };
  }

  // Re-validate the new slot exactly like checkout.
  const earliest = earliestFulfillmentDate(
    settings.leadTimeDays,
    singaporeNow(),
    settings.dailyCutoffTime,
  );
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

/**
 * Rebuild a cart from a past order using only the tracking token as auth, so
 * guests, who never make an account in the WhatsApp + PayNow flow, can reorder
 * from the same link they bookmark. Auth differs from the account path; the
 * rebuild itself is the shared reorderFromOrderId.
 */
export async function reorderFromToken(token: string): Promise<ReorderResult> {
  if (!token) return { ok: false, error: "Order not found." };
  if (!(await rateLimit("token-reorder", { limit: 20, windowMs: 5 * 60_000 }))) {
    return { ok: false, error: "Too many requests. Please wait a few minutes." };
  }
  const admin = createAdminClient();
  const { data } = await admin
    .from("orders")
    .select("id")
    .eq("tracking_token", token)
    .maybeSingle();
  const order = data as { id: string } | null;
  if (!order) return { ok: false, error: "Order not found." };

  return reorderFromOrderId(order.id);
}

/**
 * Add treats to an order the customer already placed for the same date, so they
 * don't pay a second delivery fee. Token-gated, only while the order is still
 * early and unpaid, items re-priced server-side against the live catalogue.
 */
export async function addItemsToOrderAction(
  token: string,
  lines: { productId: string; quantity: number }[],
): Promise<AddItemsResult> {
  if (!(await rateLimit("add-items", { limit: 10, windowMs: 5 * 60_000 }))) {
    return { ok: false, error: "Too many changes. Please wait a few minutes." };
  }
  if (!(await fetchStoreSettings()).features.orderChanges) {
    return { ok: false, error: "Order changes aren’t available right now." };
  }
  const clean = (lines ?? []).filter((l) => l.productId && l.quantity > 0).slice(0, 20);
  if (clean.length === 0) return { ok: false, error: "Choose at least one treat." };

  const admin = createAdminClient();
  const { data } = await admin
    .from("orders")
    .select("id, status, payment_status, order_number, customer_name, subtotal_cents, total_cents")
    .eq("tracking_token", token)
    .maybeSingle();
  const order = data as {
    id: string;
    status: string;
    payment_status: string;
    order_number: string;
    customer_name: string;
    subtotal_cents: number;
    total_cents: number;
  } | null;
  if (!order) return { ok: false, error: "Order not found." };
  if (!isChangeable(order.status)) {
    return { ok: false, error: "This order is already being prepared and can’t be changed." };
  }
  if (order.payment_status === "paid") {
    return { ok: false, error: "This order is already paid. Message us to add more." };
  }

  const products = await fetchProducts();
  const rows: {
    product_id: string;
    product_name: string;
    unit_price_cents: number;
    quantity: number;
    selected_options: SelectedOption[];
    line_total_cents: number;
  }[] = [];
  let addedCents = 0;
  const addedNames: string[] = [];
  for (const line of clean) {
    const product = products.find((p) => p.id === line.productId && p.isAvailable);
    if (!product) continue;
    // A tracked product can only be topped up to what is actually left, so the
    // add-on flow can't commit Michelle to more than she can bake.
    const stockLeft = product.stockCount == null ? 20 : Math.min(20, product.stockCount);
    if (stockLeft <= 0) continue;
    const qty = Math.max(1, Math.min(stockLeft, Math.round(line.quantity)));
    const lineTotal = product.basePriceCents * qty;
    addedCents += lineTotal;
    addedNames.push(`${qty}x ${product.name}`);
    rows.push({
      product_id: product.id,
      product_name: product.name,
      unit_price_cents: product.basePriceCents,
      quantity: qty,
      selected_options: [],
      line_total_cents: lineTotal,
    });
  }
  if (rows.length === 0) return { ok: false, error: "Those treats aren’t available right now." };

  // Delivery fee and any discount stay the same, that's the point of adding on.
  // Items and the new total are written by one Postgres function, so a fault
  // can never add the items without also charging for them.
  const { error: rpcErr } = await admin.rpc("add_items_to_order", {
    p_order_id: order.id,
    p_items: rows,
    p_added_cents: addedCents,
  });
  if (rpcErr) return { ok: false, error: "Couldn’t add the items. Please try again." };

  await sendItemsAddedEmail(order.order_number, order.customer_name, addedNames);
  return { ok: true, addedCents };
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
