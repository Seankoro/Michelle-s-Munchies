"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { rateLimit } from "@/lib/rate-limit";
import { fetchStoreSettings } from "@/lib/settings";
import { earliestFulfillmentDate, isChangeable } from "@/lib/order";
import { singaporeDateString, singaporeNow } from "@/lib/time";
import { sendCancellationRequestEmail, sendItemsAddedEmail } from "@/lib/email";
import {
  reorderFromOrderId,
  resolveCartLines,
  type RawCartLine,
  type RawSelection,
  type ReorderResult,
} from "@/lib/cart-resolve";
import { fetchProducts, isUpcoming } from "@/lib/products";
import type { SelectedOption } from "@/lib/types";

export type LookupResult = { ok: true; token: string } | { ok: false; error: string };
export type ChangeResult = { ok: true } | { ok: false; error: string };
export type AddItemsResult = { ok: true; addedCents: number } | { ok: false; error: string };

const MAX_RESCHEDULES = 3;

/**
 * Marker the cancellation request writes into the owner's note. Kept as a
 * constant so a repeat tap can spot its own earlier line instead of stacking
 * duplicates in a field Michelle also types into.
 */
const CANCELLATION_NOTE_PREFIX = "Cancellation requested by the customer on";

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
 * early and unpaid and still inside the lead time, items re-priced server-side
 * against the live catalogue through the same resolver checkout uses.
 */
export async function addItemsToOrderAction(
  token: string,
  lines: { productId: string; quantity: number; selections?: RawSelection[] }[],
): Promise<AddItemsResult> {
  if (!(await rateLimit("add-items", { limit: 10, windowMs: 5 * 60_000 }))) {
    return { ok: false, error: "Too many changes. Please wait a few minutes." };
  }
  const settings = await fetchStoreSettings();
  if (!settings.features.orderChanges) {
    return { ok: false, error: "Order changes aren’t available right now." };
  }
  const clean = (lines ?? []).filter((l) => l.productId && l.quantity > 0).slice(0, 20);
  if (clean.length === 0) return { ok: false, error: "Choose at least one treat." };

  const admin = createAdminClient();
  const { data } = await admin
    .from("orders")
    .select(
      "id, status, payment_status, order_number, customer_name, scheduled_date, subtotal_cents, total_cents",
    )
    .eq("tracking_token", token)
    .maybeSingle();
  const order = data as {
    id: string;
    status: string;
    payment_status: string;
    order_number: string;
    customer_name: string;
    scheduled_date: string;
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
  // Adding to an order commits Michelle to more shopping and baking, so it has
  // to respect the same lead time and cutoff as placing or rescheduling one.
  // Without this an unpaid order can still grow on its own bake morning.
  const earliest = earliestFulfillmentDate(
    settings.leadTimeDays,
    singaporeNow(),
    settings.dailyCutoffTime,
  );
  if (order.scheduled_date < earliest) {
    return {
      ok: false,
      error: "This order is too close to its date to add to. Please message us instead.",
    };
  }

  const products = await fetchProducts();
  const raw: RawCartLine[] = [];
  // Products the customer picked that need a size or flavour we can't ask for here.
  const needsChoice: string[] = [];
  for (const line of clean) {
    const product = products.find((p) => p.id === line.productId && p.isAvailable);
    if (!product) continue;
    // A seasonal drop that hasn't opened yet is blocked at checkout, so it can't
    // come in through the add-on panel either.
    if (isUpcoming(product)) continue;
    const selections = (line.selections ?? []).filter((s) => s.valueLabel);
    // Never guess a required choice. Michelle bakes what the line says and no
    // admin screen can edit it afterwards, so an unanswered size or flavour has
    // to be refused rather than silently defaulted.
    const unanswered = product.options.some(
      (option) =>
        option.required &&
        !selections.some(
          (s) =>
            s.optionName === option.name || option.values.some((v) => v.label === s.valueLabel),
        ),
    );
    if (unanswered) {
      needsChoice.push(product.name);
      continue;
    }
    // A tracked product can only be topped up to what is actually left, so the
    // add-on flow can't commit Michelle to more than she can bake.
    const stockLeft = product.stockCount == null ? 20 : Math.min(20, product.stockCount);
    if (stockLeft <= 0) continue;
    raw.push({
      productId: product.id,
      productName: product.name,
      quantity: Math.max(1, Math.min(stockLeft, Math.round(line.quantity))),
      selections,
    });
  }
  if (needsChoice.length > 0) {
    const names = needsChoice.join(", ");
    return {
      ok: false,
      error: `${names} ${needsChoice.length === 1 ? "needs a size or flavour chosen" : "need a size or flavour chosen"}. Please message us to add ${needsChoice.length === 1 ? "it" : "them"}.`,
    };
  }

  // Same resolver as checkout, so the name, the chosen values, and the unit
  // price with each value's delta folded in all come from the live catalogue.
  const { items } = await resolveCartLines(raw);

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
  for (const item of items) {
    const lineTotal = item.unitPriceCents * item.quantity;
    addedCents += lineTotal;
    // Name the chosen values in the email too, so Michelle knows which tin to
    // reach for without opening the order.
    const chosen = item.selectedOptions.map((o) => o.valueLabel).join(", ");
    addedNames.push(`${item.quantity}x ${item.name}${chosen ? ` (${chosen})` : ""}`);
    rows.push({
      product_id: item.productId,
      product_name: item.name,
      unit_price_cents: item.unitPriceCents,
      quantity: item.quantity,
      selected_options: item.selectedOptions,
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

/**
 * Customer asks to cancel. The admin does the actual cancel and refund, so this
 * writes the request onto the order first and then emails the owner. The note is
 * the record that survives an email nobody opens, which one fire-and-forget send
 * is not, and it is what lets us honestly tell the customer we have it.
 */
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
    .select("id, status, order_number, customer_name, owner_note")
    .eq("tracking_token", token)
    .maybeSingle();
  const order = data as {
    id: string;
    status: string;
    order_number: string;
    customer_name: string;
    owner_note: string | null;
  } | null;
  if (!order) return { ok: false, error: "Order not found." };
  // The same window as reschedule and add-items, so all three token actions
  // agree rather than relying on the page to hide the button.
  if (!isChangeable(order.status)) {
    return { ok: false, error: "This order is already being prepared and can’t be changed." };
  }

  // The owner's note is the one field on an order the admin panel already puts
  // in front of Michelle, so the request goes there. Written once, so a second
  // tap can't fill her note with repeats.
  const note = order.owner_note ?? "";
  if (!note.includes(CANCELLATION_NOTE_PREFIX)) {
    const line = `${CANCELLATION_NOTE_PREFIX} ${singaporeDateString()}.`;
    const { error } = await admin
      .from("orders")
      .update({
        owner_note: note ? `${note}\n${line}` : line,
        updated_at: new Date().toISOString(),
      })
      .eq("id", order.id);
    if (error) {
      return { ok: false, error: "Couldn’t send the request. Please message us on WhatsApp." };
    }
  }

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
