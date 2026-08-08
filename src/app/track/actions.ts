"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { rateLimit } from "@/lib/rate-limit";
import { fetchStoreSettings } from "@/lib/settings";
import { earliestFulfillmentDate, isChangeable } from "@/lib/order";
import { singaporeNow } from "@/lib/time";
import {
  sendCancellationRequestEmail,
  sendCustomerRescheduledEmail,
  sendItemsAddedEmail,
} from "@/lib/email";
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
/**
 * `added` names the lines that really went onto the order and `skipped` the ones
 * that could not, so the panel never has to assume the add was whole.
 */
export type AddItemsResult =
  | { ok: true; addedCents: number; added: string[] }
  | { ok: false; error: string; skipped?: string[] };

const MAX_RESCHEDULES = 3;
/** Lines and per-line quantity one top-up may carry, the panel's own limits. */
const MAX_ADD_LINES = 20;
const MAX_ADD_QUANTITY = 20;

/**
 * Self-serve reschedule from the tracking link. Auth = possession of the 32-char
 * tracking token. Re-validates lead time, cutoff, blackout, and the per-window
 * and daily caps server-side while excluding this order's own slot, only while
 * the order is still early, capped at MAX_RESCHEDULES, rate-limited.
 *
 * Only an order Michelle has not confirmed yet and is not already shopping for
 * can move on its own. Once she has confirmed it, or the date it currently sits
 * on is inside the lead time, she has plans built around that day and the
 * customer has to talk to her instead of moving it out from under her.
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
    .select(
      "id, status, reschedule_count, order_number, customer_name, scheduled_date, time_window",
    )
    .eq("tracking_token", token)
    .maybeSingle();
  const order = data as {
    id: string;
    status: string;
    reschedule_count: number;
    order_number: string;
    customer_name: string;
    scheduled_date: string;
    time_window: string | null;
  } | null;
  if (!order) return { ok: false, error: "Order not found." };
  if (!isChangeable(order.status)) {
    return { ok: false, error: "This order is already being prepared and can’t be changed." };
  }
  // Confirming an order is Michelle saying she has taken it on for that day, so
  // from then on the date is hers to move and not the customer's.
  if (order.status !== "received") {
    return {
      ok: false,
      error: "We’ve already confirmed this order. Please message us on WhatsApp to move the date.",
    };
  }
  if (order.reschedule_count >= MAX_RESCHEDULES) {
    return { ok: false, error: "This order has been rescheduled too many times. Please message us." };
  }

  // Same lead time and cutoff checkout uses, applied twice, once to the date the
  // order sits on now and once to the date they picked.
  const earliest = earliestFulfillmentDate(
    settings.leadTimeDays,
    singaporeNow(),
    settings.dailyCutoffTime,
  );
  // Inside the lead time she is likely already shopping or baking for this one,
  // so moving it silently would waste ingredients she has already bought.
  if (order.scheduled_date < earliest) {
    return {
      ok: false,
      error: "This order is too close to its date to move. Please message us on WhatsApp instead.",
    };
  }
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

  // Nothing on the order records the old slot once it is overwritten, so the mail
  // carries both. Best-effort like the other notification paths, so a mail hiccup
  // never makes a reschedule that really happened look failed.
  try {
    await sendCustomerRescheduledEmail({
      orderNumber: order.order_number,
      customerName: order.customer_name,
      fromDate: order.scheduled_date,
      fromWindow: order.time_window ?? "",
      toDate: newDate,
      toWindow: newWindow,
      trackingToken: token,
    });
  } catch (emailError) {
    console.error("[reschedule] notification email failed:", emailError);
  }
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
 *
 * All or nothing. If any line cannot go on, nothing is written and the answer
 * names the treats it refused, because adding some of them and reporting plain
 * success leaves the customer certain that everything they picked is on the
 * order and leaves Michelle baking against a list they never agreed to.
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
  const clean = (lines ?? []).filter((l) => l.productId && l.quantity > 0);
  if (clean.length === 0) return { ok: false, error: "Choose at least one treat." };
  // Trimming the list to the cap would be the same silent drop this action is
  // meant to stop doing, so an oversized batch is refused instead.
  if (clean.length > MAX_ADD_LINES) {
    return { ok: false, error: "That’s too many treats to add at once. Please message us." };
  }

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
  // Products that can't go on the order at all, named so the answer below can say
  // which treat instead of leaving the customer to work it out.
  const unavailable: string[] = [];
  for (const line of clean) {
    const product = products.find((p) => p.id === line.productId);
    // A seasonal drop that hasn't opened yet is blocked at checkout, so it can't
    // come in through the add-on panel either. Everything else about whether a
    // treat can be sold, unticked products, sold-out flavours and tracked stock,
    // is resolveCartLines' rule below and is not repeated here.
    if (!product || isUpcoming(product)) {
      unavailable.push(product?.name ?? "a treat that’s no longer on the menu");
      continue;
    }
    const selections = (line.selections ?? []).filter((s) => s.valueLabel);
    // Never guess a required choice. Michelle bakes what the line says and no
    // admin screen can edit it afterwards, so an unanswered size or flavour has
    // to be refused rather than silently defaulted, which is what the resolver's
    // own fallback to the first value she can still make would do with it.
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
    raw.push({
      productId: product.id,
      productName: product.name,
      // Capped like the panel's own quantity box, so a forged call can't commit
      // Michelle to a thousand cupcakes. Stock is deliberately not clamped here.
      // The resolver refuses the line against what is genuinely uncommitted, and
      // clamping to a bare stock_count would both overstate it and quietly hand
      // back fewer treats than the customer asked for.
      quantity: Math.max(1, Math.min(MAX_ADD_QUANTITY, Math.round(line.quantity))),
      selections,
    });
  }

  // Same resolver as checkout, so the name, the chosen values, and the unit
  // price with each value's delta folded in all come from the live catalogue.
  // Its `skipped` is the lines it would not price, which used to be dropped on
  // the floor here and is the other half of what the customer is told below.
  const { items, skipped } = await resolveCartLines(raw);
  for (const line of skipped) unavailable.push(line.name);

  // One refused line refuses the whole add. Nothing has been written yet, so the
  // answer can say plainly that the order is untouched and which treat to take
  // off, rather than reporting success over an order that is missing it.
  const refused = [...needsChoice, ...unavailable];
  if (refused.length > 0) {
    const parts: string[] = [];
    if (needsChoice.length > 0) {
      parts.push(
        `${needsChoice.join(", ")} ${needsChoice.length === 1 ? "needs" : "need"} a size or flavour chosen`,
      );
    }
    if (unavailable.length > 0) {
      parts.push(
        `${unavailable.join(", ")} ${unavailable.length === 1 ? "isn’t" : "aren’t"} available right now`,
      );
    }
    const them = refused.length === 1 ? "it" : "them";
    return {
      ok: false,
      error: `${parts.join(", and ")}. Nothing was added, so take ${them} off and try again, or message us and we’ll add ${them} by hand.`,
      skipped: refused,
    };
  }

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
  // Every raw line lands in the resolver's `items` or in its `skipped`, so an
  // empty list here means that stopped holding. Guarded anyway, because an add
  // of nothing answering "Added!" is the exact thing this function must not do.
  if (rows.length === 0) return { ok: false, error: "Those treats aren’t available right now." };

  // Delivery fee and any discount stay the same, that's the point of adding on.
  // Items and the new total are written by one Postgres function, so a fault
  // can never add the items without also charging for them.
  const { error: rpcErr } = await admin.rpc("add_items_to_order", {
    p_order_id: order.id,
    p_items: rows,
    p_added_cents: addedCents,
  });
  if (rpcErr) {
    // The order can be marked paid, or moved on to baking, in the time between
    // the check near the top of this action and this write. The function now
    // refuses that rather than quietly inflating a paid total, so tell the
    // customer what actually happened instead of asking them to try again at
    // something that will never work.
    if (rpcErr.message.includes("order_not_changeable")) {
      return {
        ok: false,
        error: "This order was just confirmed or paid, so it can’t be added to. Message us and we’ll sort it.",
      };
    }
    return { ok: false, error: "Couldn’t add the items. Please try again." };
  }

  await sendItemsAddedEmail(order.order_number, order.customer_name, addedNames);
  // The same list Michelle's email carries, so the customer is told exactly what
  // went on rather than being left to trust that all of it did.
  return { ok: true, addedCents, added: addedNames };
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
    .select("id, status, order_number, customer_name, cancellation_requested_at")
    .eq("tracking_token", token)
    .maybeSingle();
  const order = data as {
    id: string;
    status: string;
    order_number: string;
    customer_name: string;
    cancellation_requested_at: string | null;
  } | null;
  if (!order) return { ok: false, error: "Order not found." };
  // The same window as reschedule and add-items, so all three token actions
  // agree rather than relying on the page to hide the button.
  if (!isChangeable(order.status)) {
    return { ok: false, error: "This order is already being prepared and can’t be changed." };
  }

  // A stamp of its own rather than a line in owner_note. The stale-order sweep
  // reads an owner_note as proof a human was involved and then leaves the order
  // alone, so recording the request there made the order permanently
  // un-sweepable and it held its promo redemption and reserved points for good.
  // Anyone with a tracking link could do that, and a link is minted by placing a
  // guest order with no payment. It is also backwards: an order the customer has
  // ASKED to cancel is the last one that should be exempt from the sweep.
  //
  // Claimed only when unset, so a second tap cannot re-stamp it, and
  // deliberately without touching updated_at, which the sweep also reads as a
  // human having been here.
  if (!order.cancellation_requested_at) {
    const { data: claimed, error } = await admin
      .from("orders")
      .update({ cancellation_requested_at: new Date().toISOString() })
      .eq("id", order.id)
      .is("cancellation_requested_at", null)
      .select("id")
      .maybeSingle();
    if (error) {
      return { ok: false, error: "Couldn’t send the request. Please message us on WhatsApp." };
    }
    // Only the tap that actually claimed the stamp mails Michelle. The send used
    // to sit outside this block and fired on every call, so anyone holding a
    // tracking link, and a link is minted by placing a guest order with no
    // payment, could tap repeatedly and fill her inbox with the same request.
    // Same claim-then-send shape the reminder jobs use.
    if (claimed) {
      await sendCancellationRequestEmail(order.order_number, order.customer_name);
    }
  }

  // Still ok when it was already recorded, so a customer tapping twice is told
  // their request is in rather than meeting an error.
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
