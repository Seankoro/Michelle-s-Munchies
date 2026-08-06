import "server-only";
import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  sendStatusEmail,
  sendLowStockEmail,
  sendReviewRequestEmail,
  sendRescheduleEmail,
  sendOrderCancelledEmail,
  sendDepositOwedEmail,
} from "@/lib/email";
import { formatPrice } from "@/lib/catalog";
import { notifySubscribers } from "@/lib/stock-notify";
import { fetchStoreSettings, parseMascotMessages } from "@/lib/settings";
import { rowToFeatureFlags } from "@/lib/feature-flags";
import { refundOrder } from "@/lib/payments";
import { resolveDeliveryFeeCents } from "@/lib/delivery-pricing";
import type { PromoDiscountType } from "@/lib/promos";
import type { AdminSettings } from "@/components/admin/AdminStore";
import type { NotePrompt } from "@/lib/settings";
import type {
  AdminOrder,
  DeliveryAddress,
  OrderStatus,
  PaymentStatus,
} from "@/lib/order";
import { statusRequiresPayment } from "@/lib/order";
import type { CartItem, Personalisation, Product, SelectedOption } from "@/lib/types";

// ---- Orders. Not public-readable, admin and service-role only ----------
type OrderItemRow = {
  id: string;
  personalisation: Personalisation | null;
  product_id: string | null;
  product_name: string;
  unit_price_cents: number;
  quantity: number;
  selected_options: SelectedOption[] | null;
};
type OrderRow = {
  order_number: string;
  status: OrderStatus;
  payment_status: PaymentStatus;
  fulfillment_type: "pickup" | "delivery";
  scheduled_date: string;
  time_window: string | null;
  delivery_address: DeliveryAddress | null;
  customer_name: string;
  email: string;
  phone: string;
  notes: string | null;
  is_gift: boolean | null;
  gift_message: string | null;
  recipient_name: string | null;
  recipient_phone: string | null;
  owner_note: string | null;
  note_answers: { id: string; label: string; answer: string }[] | null;
  cancellation_requested_at: string | null;
  deposit_cents: number | null;
  paid_at: string | null;
  deposit_outstanding_cents: number | null;
  stripe_payment_intent_id: string | null;
  subtotal_cents: number;
  delivery_fee_cents: number;
  total_cents: number;
  created_at: string;
  order_items: OrderItemRow[] | null;
  /** Nested through the foreign key on order_refunds.order_id. */
  order_refunds: { amount_cents: number }[] | null;
};

function rowToAdminOrder(row: OrderRow): AdminOrder {
  const items: CartItem[] = (row.order_items ?? []).map((item) => ({
    key: item.id,
    productId: item.product_id ?? "",
    slug: "",
    name: item.product_name,
    unitPriceCents: item.unit_price_cents,
    quantity: item.quantity,
    selectedOptions: item.selected_options ?? [],
    ...(item.personalisation ? { personalisation: item.personalisation } : {}),
  }));

  return {
    orderNumber: row.order_number,
    status: row.status,
    paymentStatus: row.payment_status,
    fulfillmentType: row.fulfillment_type,
    scheduledDate: row.scheduled_date,
    timeWindow: row.time_window ?? "",
    address: row.delivery_address ?? undefined,
    name: row.customer_name,
    email: row.email,
    phone: row.phone,
    notes: row.notes ?? undefined,
    isGift: row.is_gift ?? false,
    giftMessage: row.gift_message ?? undefined,
    recipientName: row.recipient_name ?? undefined,
    recipientPhone: row.recipient_phone ?? undefined,
    ownerNote: row.owner_note ?? undefined,
    // Answers to the owner's own checkout questions. She can mark a prompt
    // required, so these can carry an allergy or a piping name, and until now
    // they reached only the order-alert email and no screen she works from.
    noteAnswers: row.note_answers ?? [],
    paidViaStripe: Boolean(row.stripe_payment_intent_id),
    cancellationRequestedAt: row.cancellation_requested_at,
    depositCents: row.deposit_cents,
    paidAt: row.paid_at,
    depositOutstandingCents: row.deposit_outstanding_cents,
    refundedCents: (row.order_refunds ?? []).reduce((sum, r) => sum + r.amount_cents, 0),
    subtotalCents: row.subtotal_cents,
    deliveryFeeCents: row.delivery_fee_cents,
    totalCents: row.total_cents,
    createdAt: row.created_at,
    items,
  };
}

/** How many recent orders the admin snapshot loads. Bounds an otherwise
 *  unbounded fetch that runs on mount and every tab refocus. Far beyond a home
 *  bakery's volume; if a shop ever nears it, move the lifetime and all-time
 *  Insights figures to a server-side aggregate rather than raising this. */
const ADMIN_ORDER_LIMIT = 1000;

export async function fetchAdminOrders(): Promise<AdminOrder[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("orders")
    .select("*, order_items(*), order_refunds(amount_cents)")
    .order("created_at", { ascending: false })
    .limit(ADMIN_ORDER_LIMIT);
  if (error) throw new Error(`Failed to load orders: ${error.message}`);
  return ((data as OrderRow[] | null) ?? []).map(rowToAdminOrder);
}

export async function updateOrderStatus(orderNumber: string, status: OrderStatus) {
  const supabase = createAdminClient();
  // Paid-before-baking: an order can only move into a work status once it is
  // paid. received/confirmed stay available while unpaid, and cancel is handled
  // separately, so neither is blocked here. The paid condition rides on the
  // UPDATE itself rather than a separate read, so a payment change landing in
  // between can never slip an unpaid order into baking.
  let updateQuery = supabase
    .from("orders")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("order_number", orderNumber);
  if (statusRequiresPayment(status)) {
    updateQuery = updateQuery.eq("payment_status", "paid");
  }
  const { data: updated, error } = await updateQuery.select("id").maybeSingle();
  if (error) throw new Error(`Failed to update status: ${error.message}`);
  if (!updated) {
    throw new Error(
      statusRequiresPayment(status)
        ? "Mark this order paid before moving it to baking or beyond."
        : "Order not found.",
    );
  }

  // Notify the customer of the new status. Never throws.
  const { data } = await supabase
    .from("orders")
    .select("email, phone, customer_name, tracking_token")
    .eq("order_number", orderNumber)
    .single();
  if (data) {
    const row = data as {
      email: string;
      phone: string;
      customer_name: string;
      tracking_token: string;
    };
    await sendStatusEmail({
      orderNumber,
      trackingToken: row.tracking_token,
      name: row.customer_name,
      email: row.email,
      status,
    });
  }

  if (status === "completed") await maybeSendReviewRequest(orderNumber);
}

/**
 * On a completed, paid order from a signed-in customer, email a review request
 * once. Verified-buyer reviews need an account and a paid purchase, so guests
 * and unpaid orders are skipped, and review_request_sent_at is claimed
 * atomically so re-completing an order never re-nudges. Never throws.
 */
async function maybeSendReviewRequest(orderNumber: string) {
  const supabase = createAdminClient();
  if (!(await fetchStoreSettings()).features.reviews) return;

  const { data } = await supabase
    .from("orders")
    .select("id, user_id, email, customer_name, payment_status, review_request_sent_at")
    .eq("order_number", orderNumber)
    .maybeSingle();
  const order = data as {
    id: string;
    user_id: string | null;
    email: string;
    customer_name: string;
    payment_status: string;
    review_request_sent_at: string | null;
  } | null;
  if (
    !order ||
    !order.user_id ||
    order.payment_status !== "paid" ||
    order.review_request_sent_at
  ) {
    return;
  }

  // Claim the send atomically so a re-completed order never re-nudges.
  const { data: claim } = await supabase
    .from("orders")
    .update({ review_request_sent_at: new Date().toISOString() })
    .eq("id", order.id)
    .is("review_request_sent_at", null)
    .select("id")
    .maybeSingle();
  if (!claim) return;

  const { data: itemRows } = await supabase
    .from("order_items")
    .select("product_id")
    .eq("order_id", order.id);
  const productIds = [
    ...new Set(
      ((itemRows as { product_id: string | null }[] | null) ?? [])
        .map((i) => i.product_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  if (productIds.length === 0) return;

  const { data: prodRows } = await supabase
    .from("products")
    .select("name, slug")
    .in("id", productIds);
  const products = (prodRows as { name: string; slug: string }[] | null) ?? [];
  if (products.length === 0) return;

  await sendReviewRequestEmail({ to: order.email, name: order.customer_name, orderNumber, products });
}

export async function updatePaymentStatus(orderNumber: string, paymentStatus: PaymentStatus) {
  const supabase = createAdminClient();
  // Reaching "paid" must run the same side effects as a Stripe payment: award
  // loyalty points, deduct any the customer redeemed, decrement tracked stock,
  // and reward referrals. PayNow orders are marked paid here by hand, not by a
  // webhook, so without this those never fire and redeemed points could be
  // re-spent forever. markOrderPaid guards the transition, so it is idempotent.
  if (paymentStatus === "paid") {
    await markOrderPaid(orderNumber, null);
    // markOrderPaid stays quiet when its guarded update matches nothing,
    // because a duplicate Stripe webhook has to be a no-op. Michelle pressing
    // Mark paid is never a duplicate, and the panel flips the badge to Paid
    // before the action resolves, so silence would leave her looking at a Paid
    // order the database still calls pending. Read the row back and say why.
    const { data: after } = await supabase
      .from("orders")
      .select("status, payment_status")
      .eq("order_number", orderNumber)
      .maybeSingle();
    const row = after as { status: OrderStatus; payment_status: PaymentStatus } | null;
    if (!row) throw new Error("Order not found.");
    if (row.payment_status !== "paid") {
      throw new Error(
        row.status === "cancelled"
          ? "This order is cancelled. Move it back to confirmed before marking it paid."
          : "Failed to mark this order paid.",
      );
    }
    return;
  }
  const { data } = await supabase
    .from("orders")
    .select("id, status, payment_status, stripe_payment_intent_id")
    .eq("order_number", orderNumber)
    .maybeSingle();
  const order = data as {
    id: string;
    status: OrderStatus;
    payment_status: PaymentStatus;
    stripe_payment_intent_id: string | null;
  } | null;
  if (!order) throw new Error("Order not found.");
  // Undoing a hand-marked payment is just a correction, because the money never
  // arrived. Undoing a card payment is not: Stripe really is holding it, and
  // clearing the flag here would leave the order calling itself unpaid while the
  // customer has been charged. That one has to go back through the refund.
  if (order.payment_status === "paid" && order.stripe_payment_intent_id) {
    throw new Error(
      "This one was paid by card, so it cannot simply be marked unpaid. Use Cancel and refund to send the money back.",
    );
  }
  // The paid-before-baking rule holds in both directions: once an order is in
  // a work status, its payment cannot be flipped back to unpaid, or the order
  // would keep baking while unpaid with nothing restoring the invariant. This is
  // the only rule about moving payment off paid, and it is the whole of it. A
  // caller that decides for itself that paid is final never gets here, and the
  // undo below stops being code anybody can run.
  if (statusRequiresPayment(order.status)) {
    throw new Error("Move this order back to confirmed before changing its payment.");
  }
  const { error } = await supabase
    .from("orders")
    .update({
      payment_status: paymentStatus,
      // Moving off paid means the money is not in hand after all, so drop the
      // arrival date with it rather than leaving revenue booked to a month whose
      // payment was undone.
      paid_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("order_number", orderNumber);
  if (error) throw new Error(`Failed to update payment: ${error.message}`);
  // Undoing a mistaken paid puts any decremented stock back and hands the
  // loyalty points back, mirroring what ran on the paid transition. Stamp
  // guarded, so an order that never went paid is a no-op, and marking it paid
  // again applies the side effects again, which the ledger only manages because
  // applyOrderPoints writes the re-application row the unique indexes refuse.
  if (order.payment_status === "paid") {
    await reversePaidSideEffects(order.id);
  }
}

/** Admin reschedule: move an order's date and time window. No customer-facing caps. */
export async function rescheduleOrder(orderNumber: string, date: string, timeWindow: string) {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("orders")
    .update({ scheduled_date: date, time_window: timeWindow, updated_at: new Date().toISOString() })
    .eq("order_number", orderNumber);
  if (error) throw new Error(`Failed to reschedule: ${error.message}`);

  // Let the customer know their bake date moved. Best-effort, never throws.
  const { data } = await supabase
    .from("orders")
    .select("email, customer_name, tracking_token")
    .eq("order_number", orderNumber)
    .maybeSingle();
  if (data) {
    const row = data as { email: string; customer_name: string; tracking_token: string };
    await sendRescheduleEmail({
      orderNumber,
      trackingToken: row.tracking_token,
      name: row.customer_name,
      email: row.email,
      scheduledDate: date,
      timeWindow,
    });
  }
}

/**
 * Set or correct where a delivery order is going, and the window it goes in.
 *
 * This is the owner's way in, and the only one. The gift link answers the
 * address question once and then closes itself, because it is meant to be
 * forwarded and anyone holding it could otherwise redirect a paid gift. That
 * left a mistyped postal code, an old unit number, or a recipient who never
 * opened the link with nobody able to fix it, and the refusal the recipient
 * reads promises a human who had no control to do it with. It does not reopen
 * the customer-side path, it adds Michelle's.
 *
 * Refused once the order is baking or beyond, the same line removeOrderItems
 * draws, and on a cancelled order: by then the food and the delivery run are
 * decided, so a new address is a conversation rather than an edit.
 *
 * Returns the fee and total the order now carries, so the panel paints what was
 * written rather than guessing at a zone it cannot see.
 */
export async function setDeliveryAddress(
  orderNumber: string,
  address: { line1: string; unit: string; postalCode: string },
  timeWindow: string,
): Promise<{ deliveryFeeCents: number; totalCents: number }> {
  const supabase = createAdminClient();
  const line1 = address.line1.trim();
  const postal = address.postalCode.trim();
  // The same two rules checkout enforces on its own address fields, so an
  // address corrected from here can never be one checkout would have refused.
  if (!line1 || !/^\d{6}$/.test(postal)) {
    throw new Error("Enter the address and a 6-digit postal code.");
  }

  const { data } = await supabase
    .from("orders")
    .select(
      "id, status, payment_status, fulfillment_type, subtotal_cents, delivery_fee_cents, discount_cents, total_cents, deposit_cents, is_gift, recipient_token, recipient_scheduled_at",
    )
    .eq("order_number", orderNumber)
    .maybeSingle();
  const order = data as {
    id: string;
    status: OrderStatus;
    payment_status: PaymentStatus;
    fulfillment_type: "pickup" | "delivery";
    subtotal_cents: number;
    delivery_fee_cents: number;
    discount_cents: number;
    total_cents: number;
    deposit_cents: number | null;
    is_gift: boolean | null;
    recipient_token: string | null;
    recipient_scheduled_at: string | null;
  } | null;
  if (!order) throw new Error("Order not found.");
  if (order.status === "cancelled") {
    throw new Error("This order is cancelled, so there is nowhere left to send it.");
  }
  if (statusRequiresPayment(order.status)) {
    throw new Error(
      "This order is already being baked. Message the customer about the address instead of moving where it is going.",
    );
  }

  const deliveryAddress: DeliveryAddress = {
    line1,
    unit: address.unit.trim() || undefined,
    postalCode: postal,
  };
  const updates: Record<string, unknown> = {
    delivery_address: deliveryAddress,
    updated_at: new Date().toISOString(),
  };
  // Only when one was actually chosen. An order can reach here with no window,
  // and writing a blank over the customer's own choice, or recording a window
  // nobody picked, both send the box out at a time nobody agreed to.
  const window = timeWindow.trim();
  if (window) updates.time_window = window;
  // Michelle typing the address IS the answer to the question the recipient's
  // link asks, so record it as answered. That stamp is the one thing four other
  // places read: unstamped, the hourly chase keeps emailing the buyer that we
  // have no address for a gift he phoned in yesterday, his tracking page keeps
  // offering the link to forward, the recipient's page still shows an empty
  // form, and the link itself stays armed to overwrite what she just wrote.
  // Stamping closes all four, and changing it afterwards goes through her,
  // which is the rule that link already states.
  //
  // Only when it was never answered, so a later typo correction does not move
  // the moment the recipient actually replied.
  if (order.is_gift && order.recipient_token && !order.recipient_scheduled_at) {
    updates.recipient_scheduled_at = new Date().toISOString();
  }
  let deliveryFeeCents = order.delivery_fee_cents;
  let totalCents = order.total_cents;
  // A corrected address can land across a zone boundary, so an unpaid delivery
  // is re-priced exactly the way the recipient's own gift link prices it and
  // Michelle collects the right amount. A PAID order is not: the customer was
  // charged and the money is settled, so moving the total here would leave the
  // order disagreeing with what was actually taken, and there is no honest way
  // to collect or return the difference from a screen. The address moves, the
  // money does not.
  if (order.fulfillment_type === "delivery" && order.payment_status !== "paid") {
    const settings = await fetchStoreSettings();
    deliveryFeeCents = await resolveDeliveryFeeCents(
      "delivery",
      order.subtotal_cents,
      postal,
      settings,
    );
    totalCents = Math.max(0, order.subtotal_cents + deliveryFeeCents - order.discount_cents);
    // A cheaper zone can take the total under a deposit already banked, which
    // would show the customer a negative balance due and leave Michelle holding
    // money the order no longer accounts for. Same guard the item removal uses,
    // and the address itself is still worth saving, so only the re-price is held
    // back and she is told which way it went.
    const depositCents = order.deposit_cents ?? 0;
    if (depositCents > 0 && totalCents < depositCents) {
      throw new Error(
        `That address prices the order below the ${formatPrice(depositCents)} deposit already taken. Adjust the deposit first, then set the address.`,
      );
    }
    updates.delivery_fee_cents = deliveryFeeCents;
    updates.total_cents = totalCents;
  }

  const { error } = await supabase.from("orders").update(updates).eq("id", order.id);
  if (error) throw new Error(`Failed to save the address: ${error.message}`);
  return { deliveryFeeCents, totalCents };
}

/**
 * Record a deposit already collected on an order. 0 clears it back to null.
 * Capped at the order total, since a deposit above it would show a nonsense
 * negative balance due in the panel.
 */
export async function recordDeposit(orderNumber: string, cents: number) {
  const supabase = createAdminClient();
  let value = cents > 0 ? Math.round(cents) : null;
  if (value != null) {
    const { data } = await supabase
      .from("orders")
      .select("total_cents")
      .eq("order_number", orderNumber)
      .maybeSingle();
    const total = (data as { total_cents: number } | null)?.total_cents;
    if (total != null) value = Math.min(value, total);
  }
  const { error } = await supabase
    .from("orders")
    .update({ deposit_cents: value, updated_at: new Date().toISOString() })
    .eq("order_number", orderNumber);
  if (error) throw new Error(`Failed to record deposit: ${error.message}`);
}

/** Save Michelle's private note on an order. An empty string clears it back to null. */
export async function updateOwnerNote(orderNumber: string, note: string) {
  const supabase = createAdminClient();
  const trimmed = note.trim();
  const { error } = await supabase
    .from("orders")
    .update({ owner_note: trimmed || null, updated_at: new Date().toISOString() })
    .eq("order_number", orderNumber);
  if (error) throw new Error(`Failed to save note: ${error.message}`);
}

/**
 * Undo what the paid transition did to the rest of the shop: add ordered
 * quantities back to any tracked product, and hand the loyalty points back.
 */
async function reversePaidSideEffects(orderId: string) {
  const supabase = createAdminClient();
  // Only reverse if the paid transition actually ran, and only once. Clearing
  // the decrement stamp atomically means a re-cancel can't add the same units
  // back twice or refund the same points twice, and an order that never went
  // paid is a no-op.
  const { data: claim } = await supabase
    .from("orders")
    .update({ stock_decremented_at: null })
    .eq("id", orderId)
    .not("stock_decremented_at", "is", null)
    .select("id")
    .maybeSingle();
  if (!claim) return;
  const { data: itemRows } = await supabase
    .from("order_items")
    .select("product_id, quantity")
    .eq("order_id", orderId);
  for (const item of (itemRows as { product_id: string | null; quantity: number }[] | null) ?? []) {
    if (!item.product_id) continue;
    // Atomic restock in the DB. Untracked products return no row and are skipped.
    const { data: rows } = await supabase.rpc("adjust_product_stock", {
      p_id: item.product_id,
      p_delta: item.quantity,
    });
    const row = (rows as { re_enabled: boolean }[] | null)?.[0];
    // Crossing back above zero puts a product that sold itself out back on the
    // menu from inside the SQL, without ever going through updateProduct. That
    // is the moment the back-in-stock waitlist signed up for, so send the alert
    // from here too, on the same feature flag the manual toggle uses.
    if (row?.re_enabled) {
      const { features } = await fetchStoreSettings();
      if (features.backInStock) await notifySubscribers(item.product_id);
    }
  }
  await reverseOrderPoints(orderId);
  await reverseOrderReferral(orderId);
}

/**
 * Undo the referral bonus this order triggered, and put the referral back to
 * pending so it can legitimately pay out again if the same customer reorders.
 *
 * Without this a cancel took the buyer's own points back but left the referrer
 * paid for a sale that never happened, and the referral row stayed 'rewarded'
 * so the real order that followed was never rewarded at all. The ledger drifted
 * in both directions at once. Never throws, since the cancel it belongs to has
 * already gone through.
 */
async function reverseOrderReferral(orderId: string) {
  const supabase = createAdminClient();
  // The referrals row records no order id, so the ledger rows carrying this
  // order's id are the only proof that THIS order is the one that paid the
  // bonus out. No rows means nothing to undo.
  const { data } = await supabase
    .from("points_ledger")
    .select("user_id, delta, reason")
    .eq("order_id", orderId)
    .in("reason", ["referral_referrer", "referral_referee", "referral_reversed"]);
  const rows = (data as { user_id: string; delta: number; reason: string }[] | null) ?? [];
  if (rows.length === 0) return; // no referral was rewarded against this order
  // Reverse what each person is still holding from this order, not every bonus
  // row ever written against it. An order can be marked paid, undone and marked
  // paid again, and the undo puts the referral back to pending so the second
  // paid transition pays it out again. Stopping at the first reversal would
  // leave that second payout standing, and reversing every row would take the
  // same bonus back twice, so net the rows and reverse what is left.
  const netByUser = new Map<string, number>();
  for (const row of rows) {
    netByUser.set(row.user_id, (netByUser.get(row.user_id) ?? 0) + row.delta);
  }
  const reversals = [...netByUser]
    .filter(([, net]) => net !== 0)
    .map(([userId, net]) => ({
      user_id: userId,
      order_id: orderId,
      delta: -net,
      reason: "referral_reversed",
    }));
  if (reversals.length === 0) return; // already back where it started

  const { error } = await supabase.from("points_ledger").insert(reversals);
  if (error) {
    console.error(`[referral] Failed to reverse for order ${orderId}:`, error.message);
    return;
  }

  // Put the referral back to pending so it can pay out again on a real order.
  // It is matched by referee, the same way markOrderPaid claimed it, since the
  // referee is the customer whose order this was.
  const { data: orderRow } = await supabase
    .from("orders")
    .select("user_id")
    .eq("id", orderId)
    .maybeSingle();
  const userId = (orderRow as { user_id: string | null } | null)?.user_id;
  if (!userId) return;
  await supabase
    .from("referrals")
    .update({ status: "pending", rewarded_at: null })
    .eq("referee_user_id", userId)
    .eq("status", "rewarded");
}

/**
 * The ledger reasons that make up an order's own points, in the two families the
 * paid transition moves: what the customer earned on the order, and what they
 * spent on it. Undoing and re-applying add rows instead of editing the first
 * pair, because the ledger is append-only and the unique indexes allow exactly
 * one 'earned' and one 'redeemed' row per order. So what an order is holding
 * right now is the sum of its family, never the first row on its own.
 */
const EARNED_REASONS = ["earned", "earn_reversed", "earn_reapplied"];
const REDEEMED_REASONS = ["redeemed", "redeem_reversed", "redeem_reapplied"];

/**
 * Give back the loyalty points an order moved when it went paid. The ledger is
 * append-only, so undoing means writing the opposite row rather than deleting
 * one: the points the customer spent come back to them, and the points they
 * earned on money that is being returned come off again. Callers hold the
 * decrement-stamp claim, so this runs at most once per paid transition. Never
 * throws, since the cancel it belongs to has already gone through.
 *
 * What comes back is what the order is still holding, not what its first paid
 * transition wrote. A mis-tapped paid can be undone and marked paid again, and
 * each of those leaves its own row, so reversing the original 'earned' row every
 * time would take the same points off the customer twice.
 */
async function reverseOrderPoints(orderId: string) {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("points_ledger")
    .select("user_id, delta, reason")
    .eq("order_id", orderId)
    .in("reason", [...EARNED_REASONS, ...REDEEMED_REASONS]);
  const rows = (data as { user_id: string; delta: number; reason: string }[] | null) ?? [];
  if (rows.length === 0) return; // guest order, or rewards were off at the time
  const reversals = [
    { reasons: EARNED_REASONS, reversal: "earn_reversed" },
    { reasons: REDEEMED_REASONS, reversal: "redeem_reversed" },
  ].flatMap(({ reasons, reversal }) => {
    const family = rows.filter((row) => reasons.includes(row.reason));
    const net = family.reduce((sum, row) => sum + row.delta, 0);
    const userId = family[0]?.user_id;
    if (net === 0 || !userId) return [];
    return [{ user_id: userId, order_id: orderId, delta: -net, reason: reversal }];
  });
  if (reversals.length === 0) return; // already back where it started
  const { error } = await supabase.from("points_ledger").insert(reversals);
  if (error) console.error(`[points] Failed to reverse for order ${orderId}:`, error.message);
}

/**
 * Write one of the two points rows a paid transition owes, or its re-application
 * when the order already carries that row. Only one 'earned' and one 'redeemed'
 * row per order is allowed, so an order that was marked paid, had that undone,
 * and was marked paid again cannot write the same row a second time and the
 * customer would silently keep the points they spent and lose the points they
 * earned. The re-application reason moves them again, and it only fires when the
 * order's rows in that family net to zero, so a duplicate Stripe webhook stays
 * the no-op the unique index already makes it. Never throws, since the payment
 * it belongs to has already been taken.
 */
async function applyOrderPoints(
  orderId: string,
  userId: string,
  delta: number,
  reason: "earned" | "redeemed",
) {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("points_ledger")
    .insert({ user_id: userId, order_id: orderId, delta, reason });
  if (!error) return;
  // 23505 = unique_violation, so this order already carries the row.
  if (error.code !== "23505") {
    console.error(`[points] Failed to write ${reason} for order ${orderId}:`, error.message);
    return;
  }
  const earned = reason === "earned";
  const { data } = await supabase
    .from("points_ledger")
    .select("delta")
    .eq("order_id", orderId)
    .in("reason", earned ? EARNED_REASONS : REDEEMED_REASONS);
  const net = ((data as { delta: number }[] | null) ?? []).reduce((sum, row) => sum + row.delta, 0);
  if (net !== 0) return; // still applied, so this really is a duplicate
  const { error: reapplyError } = await supabase.from("points_ledger").insert({
    user_id: userId,
    order_id: orderId,
    delta,
    reason: earned ? "earn_reapplied" : "redeem_reapplied",
  });
  if (reapplyError) {
    console.error(`[points] Failed to re-apply ${reason} for order ${orderId}:`, reapplyError.message);
  }
}

/**
 * `manualRefundDue` says the customer paid but the app returned nothing, so
 * Michelle owes them `amountCents` by PayNow herself. `amountCents` is the order
 * total either way. `depositOwedCents` is the deposit this cancel recorded as
 * still owed, null when nothing is owed, so the panel can word its instruction
 * from the amount the server actually wrote instead of working the deposit rule
 * out a second time and drifting from it.
 *
 * On the failure side, `refundFailed` marks the one refusal Michelle is allowed
 * to override: Stripe would not return the money, so cancelling now would strand
 * it. Everything else is a plain error she cannot argue with.
 */
export type CancelResult =
  | {
      ok: true;
      refunded: boolean;
      manualRefundDue: boolean;
      amountCents: number;
      depositOwedCents: number | null;
    }
  | { ok: false; error: string; refundFailed?: boolean };

/**
 * Admin cancel and refund. Idempotent, so a cancelled order is a no-op. If the
 * order was paid through Stripe, refunds the PaymentIntent and restocks, then
 * marks the order cancelled, and refunded when money was returned. A PayNow or
 * hand-marked order has nothing to reverse, so it comes back manualRefundDue.
 *
 * `cancelWithoutRefund` is the way out of an order that can never be cancelled.
 * A refused Stripe refund normally blocks the cancel so the customer's money is
 * not stranded, but some refusals never come good: a charge too old to refund, a
 * charge already refunded from the Stripe dashboard, a PaymentIntent that no
 * longer exists. Retrying those forever leaves the order stuck in the bake list.
 * With this set the cancel goes through, the payment status is left exactly as
 * it is rather than being relabelled refunded, and the result comes back
 * manualRefundDue so the panel tells her how much she still has to send back.
 */
export async function cancelAndRefundOrder(
  orderNumber: string,
  depositReturned = false,
  cancelWithoutRefund = false,
): Promise<CancelResult> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("orders")
    .select(
      "id, status, payment_status, stripe_payment_intent_id, total_cents, deposit_cents, deposit_outstanding_cents, email, customer_name, tracking_token",
    )
    .eq("order_number", orderNumber)
    .maybeSingle();
  if (error || !data) return { ok: false, error: "Order not found." };
  const order = data as {
    id: string;
    status: string;
    payment_status: string;
    stripe_payment_intent_id: string | null;
    total_cents: number;
    deposit_cents: number | null;
    deposit_outstanding_cents: number | null;
    email: string;
    customer_name: string;
    tracking_token: string;
  };
  // PayNow and hand-marked orders never got a Stripe PaymentIntent, and there
  // is no way to reverse a bank transfer from here, so the money has to go back
  // by hand. Report that instead of letting a quiet skip read as "refunded".
  const paidOutsideStripe = order.payment_status === "paid" && !order.stripe_payment_intent_id;
  if (order.status === "cancelled") {
    return {
      ok: true,
      refunded: order.payment_status === "refunded",
      manualRefundDue: paidOutsideStripe,
      amountCents: order.total_cents,
      // The earlier cancel already decided this. Hand back what it recorded so a
      // repeated cancel says the same thing rather than a fresh guess.
      depositOwedCents: order.deposit_outstanding_cents,
    };
  }

  // Money may already have gone back on this order without cancelling it, so
  // only what is still outstanding may be refunded now. Stripe leaves the whole
  // card payment refundable until it is told otherwise, so an unqualified refund
  // would return the full total on top of anything already PayNowed back and the
  // customer would end up ahead of what they paid. Correct whichever way the
  // earlier money went: if it went through Stripe the remaining refundable
  // already equals this, so naming it changes nothing.
  const alreadyRefundedCents = await fetchRefundedCents(order.id);
  const outstandingCents = Math.max(0, order.total_cents - alreadyRefundedCents);

  let refunded = false;
  let stripeRefundFailed = false;
  if (order.payment_status === "paid" && order.stripe_payment_intent_id && outstandingCents === 0) {
    // Everything is already back with the customer, so there is nothing to send
    // and no Stripe call to make, but the order is still fully refunded.
    refunded = true;
  } else if (order.payment_status === "paid" && order.stripe_payment_intent_id) {
    refunded = await refundOrder(order.stripe_payment_intent_id, outstandingCents);
    stripeRefundFailed = !refunded;
    if (stripeRefundFailed && !cancelWithoutRefund) {
      // The card refund did not go through. Leave the order untouched rather than
      // cancelling it into a paid-but-unrefunded state, so the customer's money is
      // not stranded and the admin can retry the cancel. refundFailed marks this
      // as the refusal she can override once she has settled the money another
      // way, so a refund that will never succeed cannot trap the order forever.
      return {
        ok: false,
        refundFailed: true,
        error: "The Stripe refund did not go through, so the order was not cancelled. Please try again in a moment.",
      };
    }
  }
  // Money still has to go back by hand whenever the order was paid and nothing
  // went back through Stripe, whether there was no PaymentIntent to reverse or
  // the refund was refused and she cancelled anyway.
  const manualRefundDue = paidOutsideStripe || stripeRefundFailed;
  // Put stock and loyalty points back for any order that took them, however it
  // was paid (Stripe card OR a PayNow/manual order marked paid here). It self
  // guards on the decrement stamp, so an order that never went paid is a no-op.
  await reversePaidSideEffects(order.id);
  // A deposit is money already sitting in Michelle's bank that the app cannot
  // send back for her. If she has not returned it yet, record what is owed so it
  // stays in front of her instead of vanishing with the cancelled order.
  //
  // Only on an order that was NOT settled in full. Once an order is paid, the
  // deposit is part of the total that was received, and the refund (Stripe, or
  // the manualRefundDue amount she sends by hand) already covers the whole of
  // it. Recording the deposit again on top would tell her to return the total
  // AND the deposit, paying the customer twice for the same cancelled order.
  const depositCents = order.deposit_cents ?? 0;
  const settledInFull = order.payment_status === "paid" || order.payment_status === "refunded";
  const depositOwed = depositCents > 0 && !depositReturned && !settledInFull ? depositCents : null;
  const { error: updErr } = await supabase
    .from("orders")
    .update({
      status: "cancelled",
      payment_status: refunded ? "refunded" : order.payment_status,
      deposit_outstanding_cents: depositOwed,
      updated_at: new Date().toISOString(),
    })
    .eq("id", order.id);
  if (updErr) return { ok: false, error: updErr.message };

  // Record what the cancel itself sent back, so the order's refund total covers
  // every cent that left rather than only the ones she typed in by hand. Without
  // this the detail would still read "-$25 refunded" after $80 had gone.
  if (refunded && outstandingCents > 0) {
    const { error: refundLogError } = await supabase.from("order_refunds").insert({
      order_id: order.id,
      amount_cents: outstandingCents,
      reason: "Order cancelled",
      via: "stripe",
    });
    if (refundLogError) {
      console.error("[cancel] could not record the refund:", refundLogError.message);
    }
  }

  if (depositOwed != null) {
    try {
      await sendDepositOwedEmail(orderNumber, order.customer_name, depositOwed);
    } catch (emailError) {
      console.error("[cancel] deposit owed email failed:", emailError);
    }
  }

  // Tell the customer, like every other status change does. Best-effort, so a
  // mail hiccup never makes a completed cancel look failed.
  try {
    await sendOrderCancelledEmail({
      orderNumber,
      trackingToken: order.tracking_token,
      name: order.customer_name,
      email: order.email,
      refunded,
    });
  } catch (emailError) {
    console.error("[cancel] notification email failed:", emailError);
  }
  return {
    ok: true,
    refunded,
    manualRefundDue,
    amountCents: order.total_cents,
    depositOwedCents: depositOwed,
  };
}

/** Michelle has sent a held deposit back, so stop showing it as outstanding. */
export async function clearDepositOwed(orderNumber: string) {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("orders")
    .update({ deposit_outstanding_cents: null, updated_at: new Date().toISOString() })
    .eq("order_number", orderNumber);
  if (error) throw new Error(`Failed to clear the deposit owed: ${error.message}`);
}

/**
 * Record money returned to a customer WITHOUT cancelling the order, which until
 * now was the only way to give money back. A goodwill refund on a delivered
 * order, a partial refund for one squashed tin, or a refund Michelle issued
 * straight from the Stripe dashboard all belong here so the books stop counting
 * that money as revenue she kept.
 *
 * Deliberately does not cancel, restock, or touch loyalty points. The whole
 * point is that the food was delivered and the order stands; only money moved.
 */
export async function recordRefund(
  orderNumber: string,
  amountCents: number,
  reason: string,
  via: "manual" | "stripe",
) {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("orders")
    .select("id, total_cents")
    .eq("order_number", orderNumber)
    .maybeSingle();
  const order = data as { id: string; total_cents: number } | null;
  if (!order) throw new Error("Order not found.");

  // Refunds accumulate, so check the running total rather than this one amount.
  // Giving back more than was charged is always a mistake worth stopping.
  const alreadyRefunded = await fetchRefundedCents(order.id);
  if (alreadyRefunded + amountCents > order.total_cents) {
    const room = Math.max(0, order.total_cents - alreadyRefunded);
    throw new Error(
      `That is more than is left on this order. At most ${formatPrice(room)} can still be refunded.`,
    );
  }

  const { error } = await supabase.from("order_refunds").insert({
    order_id: order.id,
    amount_cents: amountCents,
    reason: reason || null,
    via,
  });
  if (error) throw new Error(`Failed to record the refund: ${error.message}`);
}

export type OrderRefund = {
  id: string;
  amountCents: number;
  reason: string | null;
  via: "manual" | "stripe";
  createdAt: string;
};

/** Every amount returned on one order, newest first, for the order detail. */
export async function fetchOrderRefunds(orderId: string): Promise<OrderRefund[]> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("order_refunds")
    .select("id, amount_cents, reason, via, created_at")
    .eq("order_id", orderId)
    .order("created_at", { ascending: false });
  const rows =
    (data as
      | { id: string; amount_cents: number; reason: string | null; via: string; created_at: string }[]
      | null) ?? [];
  return rows.map((row) => ({
    id: row.id,
    amountCents: row.amount_cents,
    reason: row.reason,
    via: row.via === "stripe" ? "stripe" : "manual",
    createdAt: row.created_at,
  }));
}

/** Total returned on one order, so revenue can subtract it. */
export async function fetchRefundedCents(orderId: string): Promise<number> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("order_refunds")
    .select("amount_cents")
    .eq("order_id", orderId);
  return ((data as { amount_cents: number }[] | null) ?? []).reduce(
    (sum, row) => sum + row.amount_cents,
    0,
  );
}

/**
 * Take lines off an order that could not be baked, so the record describes what
 * was actually delivered rather than what was ordered. Only ever on an order
 * that has not been paid for and has not started baking.
 *
 * Removing a line lowers total_cents. On an unpaid order that is exactly right:
 * nothing has been collected, so the order is simply worth less now. On a PAID
 * order it is wrong, because total_cents is also the only record of what the
 * customer actually handed over, and lowering it makes the money unreconcilable
 * in both directions: recording the matching refund subtracts the same amount
 * twice, and not recording it hides money she is still holding. So a paid order
 * is refused here and the honest tool is a refund against a truthful order,
 * which is the same reasoning the baking guard already uses.
 *
 * Returns the cents removed, worked out by the database from the rows
 * themselves.
 */
export async function removeOrderItems(orderNumber: string, itemIds: string[]): Promise<number> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("orders")
    .select(
      "id, status, payment_status, total_cents, subtotal_cents, delivery_fee_cents, discount_cents, promo_code, deposit_cents",
    )
    .eq("order_number", orderNumber)
    .maybeSingle();
  const order = data as {
    id: string;
    status: OrderStatus;
    payment_status: PaymentStatus;
    total_cents: number;
    subtotal_cents: number;
    delivery_fee_cents: number;
    discount_cents: number;
    promo_code: string | null;
    deposit_cents: number | null;
  } | null;
  if (!order) throw new Error("Order not found.");
  if (statusRequiresPayment(order.status)) {
    throw new Error(
      "This order is already being baked. Record a refund instead of changing what was ordered.",
    );
  }
  if (order.payment_status === "paid" || order.payment_status === "refunded") {
    throw new Error(
      "This order is already paid. Record a refund instead, so what was charged stays on the order.",
    );
  }

  // What the removal will take off, read once and reused by the guards below.
  const { data: removingRows } = await supabase
    .from("order_items")
    .select("line_total_cents")
    .eq("order_id", order.id)
    .in("id", itemIds);
  const removingCents = ((removingRows as { line_total_cents: number }[] | null) ?? []).reduce(
    (sum, row) => sum + row.line_total_cents,
    0,
  );
  const newSubtotal = order.subtotal_cents - removingCents;

  // A deposit is money already banked against this order. Letting the total fall
  // below it would show the customer a negative balance due and leave her
  // holding money the order no longer accounts for.
  const depositCents = order.deposit_cents ?? 0;
  if (depositCents > 0 && order.total_cents - removingCents < depositCents) {
    throw new Error(
      `That would take the order below the ${formatPrice(depositCents)} deposit already taken. Adjust the deposit first.`,
    );
  }

  // The removal moves the subtotal and the total by the same amount and leaves
  // the delivery fee and the discount exactly as they were. That is right only
  // while the smaller order still earns them. Free delivery and a promo are both
  // earned by spending enough, so quietly dropping under the threshold would
  // hand the customer a waived fee or a discount the shrunken order no longer
  // qualifies for, and Michelle absorbs the difference with nothing recording it.
  // Neither can be re-derived safely from here (a distance-zoned fee needs the
  // postal code and an external lookup, and re-pricing a promo needs its rules),
  // so refuse and say exactly what is in the way rather than get it wrong.
  const settings = await fetchStoreSettings();
  const freeMin = settings.freeDeliveryMinCents;
  if (
    order.delivery_fee_cents === 0 &&
    freeMin != null &&
    freeMin > 0 &&
    order.subtotal_cents >= freeMin &&
    newSubtotal < freeMin
  ) {
    throw new Error(
      `This order got free delivery for spending ${formatPrice(freeMin)}, and removing that much drops it under. Cancel and re-take the order, or message the customer about the delivery fee first.`,
    );
  }
  if (order.promo_code && order.discount_cents > 0) {
    const { data: promoRow } = await supabase
      .from("promo_codes")
      .select("min_order_cents")
      .eq("code", order.promo_code)
      .maybeSingle();
    const minOrder = (promoRow as { min_order_cents: number } | null)?.min_order_cents ?? 0;
    if (minOrder > 0 && order.subtotal_cents >= minOrder && newSubtotal < minOrder) {
      throw new Error(
        `Code ${order.promo_code} needs ${formatPrice(minOrder)} and removing that much drops the order under it. Cancel and re-take the order instead.`,
      );
    }
  }

  const { data: removed, error } = await supabase.rpc("remove_items_from_order", {
    p_order_id: order.id,
    p_item_ids: itemIds,
  });
  if (error) throw new Error(`Failed to remove the items: ${error.message}`);
  return typeof removed === "number" ? removed : 0;
}

/**
 * Decrements `stock_count` for each tracked product in an order and flips it to
 * sold-out at zero. Untracked products with null stock are skipped. Called from
 * the paid-transition in markOrderPaid, so it runs at most once per order.
 */
async function decrementStockForOrder(orderId: string) {
  const supabase = createAdminClient();
  // Atomically claim the decrement so an order's stock drops exactly once,
  // whichever path (Stripe webhook or admin Mark paid) marks it paid, even if
  // paid is toggled off and on again.
  const { data: claim } = await supabase
    .from("orders")
    .update({ stock_decremented_at: new Date().toISOString() })
    .eq("id", orderId)
    .is("stock_decremented_at", null)
    .select("id")
    .maybeSingle();
  if (!claim) return; // already decremented for this order
  const { lowStockThreshold } = await fetchStoreSettings();
  const ownerEmail = process.env.OWNER_NOTIFICATION_EMAIL;
  const { data: itemRows } = await supabase
    .from("order_items")
    .select("product_id, quantity")
    .eq("order_id", orderId);
  const items = (itemRows as { product_id: string | null; quantity: number }[] | null) ?? [];
  for (const item of items) {
    if (!item.product_id) continue;
    // Atomic decrement in the DB, so two orders paid at once for the same product
    // cannot both read the same count and clobber each other's write.
    const { data: rows } = await supabase.rpc("adjust_product_stock", {
      p_id: item.product_id,
      p_delta: -item.quantity,
    });
    const row = (rows as { old_count: number; new_count: number; product_name: string }[] | null)?.[0];
    if (!row) continue; // untracked → unlimited
    // Low-stock alert, fire only on the decrement that crosses the threshold.
    if (
      ownerEmail &&
      lowStockThreshold != null &&
      row.old_count > lowStockThreshold &&
      row.new_count <= lowStockThreshold
    ) {
      await sendLowStockEmail(ownerEmail, row.product_name, row.new_count);
    }
  }
}

/** Called by the Stripe webhook once payment is confirmed. */
export async function markOrderPaid(orderNumber: string, paymentIntentId: string | null) {
  const supabase = createAdminClient();
  // Only the pending-to-paid transition runs side effects. The `neq` guard makes
  // a duplicate webhook a no-op, so points and stock are never applied twice.
  const { data, error } = await supabase
    .from("orders")
    .update({
      payment_status: "paid",
      // When the money actually arrived. A PayNow order is marked paid by hand
      // days after it was placed, so bucketing revenue by the order date put it
      // in the wrong month and no period could be tied to the bank statement.
      paid_at: new Date().toISOString(),
      // Only write the column when there is an id to write. The webhook stamps
      // it as a breadcrumb when it declines to apply a payment, so a later
      // hand-marked PayNow order passing null would otherwise wipe the only
      // handle Michelle has on a stray charge she still needs to refund.
      ...(paymentIntentId ? { stripe_payment_intent_id: paymentIntentId } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("order_number", orderNumber)
    .neq("payment_status", "paid")
    // A cancelled order must never go paid: a late Stripe payment landing
    // after the cron expired the order would otherwise debit points and take
    // stock for an order nobody will bake. The payment stays visible in
    // Stripe for a manual refund.
    .neq("status", "cancelled")
    .select("id, user_id, subtotal_cents, points_redeemed")
    .maybeSingle();
  if (error) throw new Error(`Failed to mark order paid: ${error.message}`);
  if (!data) {
    // Already paid, usually a duplicate webhook, or cancelled as above. If the
    // admin marked a PayNow order paid by hand while Stripe was still
    // processing, the PaymentIntent was never stored, which would leave a
    // later refund with nothing to act on, so backfill the id without
    // re-running any paid side effects. The same backfill records the intent
    // on a cancelled order so its stray payment is easy to find and refund.
    if (paymentIntentId) {
      await supabase
        .from("orders")
        .update({ stripe_payment_intent_id: paymentIntentId })
        .eq("order_number", orderNumber)
        .is("stripe_payment_intent_id", null);
    }
    return;
  }

  // Decrement stock for tracked products and auto-sold-out at zero, guests too.
  await decrementStockForOrder((data as { id: string }).id);

  // Award or deduct loyalty points if the order belongs to a signed-in customer.
  const order = data as {
    id: string;
    user_id: string | null;
    subtotal_cents: number;
    points_redeemed: number;
  };
  if (order?.user_id) {
    // Deduct any points the customer redeemed on this order. Idempotent.
    if (order.points_redeemed > 0) {
      await applyOrderPoints(order.id, order.user_id, -order.points_redeemed, "redeemed");
    }
    // One read for the points and referral config and the relevant feature toggles.
    const { data: cfgRow } = await supabase
      .from("settings")
      .select(
        "points_per_dollar, feature_rewards, feature_referrals, referral_referrer_points, referral_referee_points",
      )
      .eq("id", 1)
      .single();
    const cfg = cfgRow as {
      points_per_dollar: number | null;
      feature_rewards: boolean | null;
      feature_referrals: boolean | null;
      referral_referrer_points: number | null;
      referral_referee_points: number | null;
    } | null;

    // Earn loyalty points, only when the rewards feature is on.
    if (cfg?.feature_rewards ?? true) {
      const perDollar = cfg?.points_per_dollar ?? 1;
      const points = Math.floor(order.subtotal_cents / 100) * perDollar;
      if (points > 0) {
        await applyOrderPoints(order.id, order.user_id, points, "earned");
      }
    }

    // Referral reward, only when referrals are on. Reward both parties once, on
    // the referee's first paid order. The status flip is the idempotency guard.
    if (cfg?.feature_referrals ?? true) {
      const { data: refRow } = await supabase
        .from("referrals")
        .update({ status: "rewarded", rewarded_at: new Date().toISOString() })
        .eq("referee_user_id", order.user_id)
        .eq("status", "pending")
        .select("referrer_user_id")
        .maybeSingle();
      if (refRow) {
        const referrerId = (refRow as { referrer_user_id: string }).referrer_user_id;
        const { error: refErr } = await supabase.from("points_ledger").insert([
          {
            user_id: referrerId,
            order_id: order.id,
            delta: cfg?.referral_referrer_points ?? 50,
            reason: "referral_referrer",
          },
          {
            user_id: order.user_id,
            order_id: order.id,
            delta: cfg?.referral_referee_points ?? 30,
            reason: "referral_referee",
          },
        ]);
        if (refErr) console.error(`[referral] reward failed for ${orderNumber}:`, refErr.message);
      }
    }
  }
}

// ---- Products. Writes need the service-role, RLS allows public reads only --
function toProductColumns(patch: Partial<Product>) {
  const columns: Record<string, unknown> = {};
  if (patch.slug !== undefined) columns.slug = patch.slug;
  if (patch.name !== undefined) columns.name = patch.name;
  if (patch.shortDescription !== undefined) columns.short_description = patch.shortDescription;
  if (patch.longDescription !== undefined) columns.long_description = patch.longDescription;
  if (patch.basePriceCents !== undefined) columns.base_price_cents = patch.basePriceCents;
  if (patch.costCents !== undefined) columns.cost_cents = patch.costCents;
  if (patch.category !== undefined) columns.category = patch.category;
  if (patch.isAvailable !== undefined) columns.is_available = patch.isAvailable;
  if (patch.isBestSeller !== undefined) columns.is_best_seller = patch.isBestSeller;
  if (patch.isRecommended !== undefined) columns.is_recommended = patch.isRecommended;
  if (patch.allergens !== undefined) columns.allergens = patch.allergens;
  if (patch.dietaryTags !== undefined) columns.dietary_tags = patch.dietaryTags;
  if (patch.ingredients !== undefined) columns.ingredients = patch.ingredients;
  if (patch.storageInfo !== undefined) columns.storage_info = patch.storageInfo;
  if (patch.servingInfo !== undefined) columns.serving_info = patch.servingInfo;
  if (patch.imageUrls !== undefined) columns.image_paths = patch.imageUrls;
  if (patch.stockCount !== undefined) columns.stock_count = patch.stockCount;
  if (patch.availableFrom !== undefined) columns.available_from = patch.availableFrom;
  if (patch.flavourBox !== undefined) columns.flavour_box = patch.flavourBox;
  if (patch.personalisation !== undefined) {
    columns.personalisation_label = patch.personalisation?.label ?? null;
    columns.personalisation_allow_photo = patch.personalisation?.allowPhoto ?? false;
  }
  return columns;
}

/**
 * Replace a product's option groups and values wholesale. The flavour editor
 * sends the full desired set, so we clear the existing groups, the values
 * cascade, and reinsert with fresh ids. Returns the saved shape with those ids.
 */
async function replaceProductOptions(
  supabase: ReturnType<typeof createAdminClient>,
  productId: string,
  options: Product["options"],
): Promise<Product["options"]> {
  const { error: clearError } = await supabase
    .from("product_options")
    .delete()
    .eq("product_id", productId);
  if (clearError) throw new Error(`Failed to clear options: ${clearError.message}`);

  if (options.length === 0) return [];

  const optionRows: {
    id: string;
    product_id: string;
    name: string;
    required: boolean;
    sort_order: number;
  }[] = [];
  const valueRows: {
    id: string;
    option_id: string;
    label: string;
    price_delta_cents: number;
    is_available: boolean;
    sort_order: number;
  }[] = [];
  const saved: Product["options"] = [];

  options.forEach((option, optionIndex) => {
    const optionId = randomUUID();
    optionRows.push({
      id: optionId,
      product_id: productId,
      name: option.name,
      required: option.required,
      sort_order: optionIndex,
    });
    const values = option.values.map((value, valueIndex) => {
      const valueId = randomUUID();
      const isAvailable = value.isAvailable !== false;
      valueRows.push({
        id: valueId,
        option_id: optionId,
        label: value.label,
        price_delta_cents: value.priceDeltaCents,
        is_available: isAvailable,
        sort_order: valueIndex,
      });
      return { id: valueId, label: value.label, priceDeltaCents: value.priceDeltaCents, isAvailable };
    });
    saved.push({ id: optionId, name: option.name, required: option.required, values });
  });

  const { error: optionError } = await supabase.from("product_options").insert(optionRows);
  if (optionError) throw new Error(`Failed to save options: ${optionError.message}`);
  if (valueRows.length > 0) {
    const { error: valueError } = await supabase.from("product_option_values").insert(valueRows);
    if (valueError) throw new Error(`Failed to save option values: ${valueError.message}`);
  }
  return saved;
}

/** Insert a new product with its option groups. The DB generates the product id. */
export async function createProduct(product: Product): Promise<Product> {
  const supabase = createAdminClient();
  // Append new products at the end of the menu. Without this every new item
  // lands at sort_order 0 and jumps ahead of the established ones.
  const { data: maxRow } = await supabase
    .from("products")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextSortOrder = ((maxRow as { sort_order: number } | null)?.sort_order ?? -1) + 1;
  const { data, error } = await supabase
    .from("products")
    .insert({ ...toProductColumns(product), sort_order: nextSortOrder })
    .select("id, slug")
    .single();
  if (error) throw new Error(`Failed to create product: ${error.message}`);
  const id = (data as { id: string }).id;
  const options = await replaceProductOptions(supabase, id, product.options ?? []);
  return { ...product, id, options };
}

export async function updateProduct(id: string, patch: Partial<Product>) {
  const supabase = createAdminClient();
  const columns: Record<string, unknown> = toProductColumns(patch);
  // An explicit availability choice from Michelle overrides any earlier
  // auto-sell-out, so a later restock won't second-guess her. Only when she
  // actually changed it, though: the product editor saves the whole draft, so
  // a description-only edit would otherwise wipe the sold-itself-out marker and
  // quietly stop a later restock from putting the product back on the menu.
  if (patch.isAvailable !== undefined) {
    const { data: current } = await supabase
      .from("products")
      .select("is_available")
      .eq("id", id)
      .maybeSingle();
    const stored = (current as { is_available: boolean } | null)?.is_available;
    if (stored !== patch.isAvailable) columns.auto_disabled = false;
  }
  if (Object.keys(columns).length > 0) {
    const { error } = await supabase
      .from("products")
      .update({ ...columns, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw new Error(`Failed to update product: ${error.message}`);
  }
  // The flavour editor includes the full options set. Replace them when present.
  if (patch.options !== undefined) {
    await replaceProductOptions(supabase, id, patch.options);
  }
  // When a product is switched back to available, email anyone waiting for it,
  // but only while the back-in-stock feature is switched on.
  if (patch.isAvailable === true) {
    const { features } = await fetchStoreSettings();
    if (features.backInStock) await notifySubscribers(id);
  }
}

export async function deleteProduct(id: string) {
  const supabase = createAdminClient();
  const { error } = await supabase.from("products").delete().eq("id", id);
  if (error) throw new Error(`Failed to delete product: ${error.message}`);
}

// ---- Settings --------------------------------------------------------------
type SettingsRow = {
  delivery_fee_cents: number;
  free_delivery_min_cents: number | null;
  min_order_cents: number;
  lead_time_days: number;
  time_windows: string[];
  blackout_dates: string[];
  pickup_location_public: string | null;
  daily_order_cap: number | null;
  points_per_dollar: number | null;
  point_value_cents: number | null;
  referral_referrer_points: number | null;
  referral_referee_points: number | null;
  feature_rewards: boolean | null;
  feature_wishlist: boolean | null;
  feature_reviews: boolean | null;
  feature_promos: boolean | null;
  feature_gifting: boolean | null;
  feature_referrals: boolean | null;
  per_window_cap: number | null;
  daily_cutoff_time: string | null;
  free_gift_threshold_cents: number | null;
  free_gift_product_id: string | null;
  birthday_reward_points: number | null;
  abandoned_after_hours: number | null;
  note_prompts: NotePrompt[] | null;
  mascot_message: string | null;
  feature_build_a_box: boolean | null;
  feature_bundles: boolean | null;
  feature_spend_gift: boolean | null;
  feature_back_in_stock: boolean | null;
  feature_photo_reviews: boolean | null;
  feature_cart_sharing: boolean | null;
  feature_wishlist_sharing: boolean | null;
  feature_instagram_feed: boolean | null;
  feature_birthday_rewards: boolean | null;
  feature_abandoned_cart: boolean | null;
  feature_structured_notes: boolean | null;
  low_stock_threshold: number | null;
  feature_order_changes: boolean | null;
  feature_newsletter: boolean | null;
  feature_drops: boolean | null;
  feature_dietary_prefs: boolean | null;
  feature_occasion_reminders: boolean | null;
};

export async function fetchAdminSettings(): Promise<AdminSettings> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("settings")
    .select("*")
    .eq("id", 1)
    .single();
  if (error) throw new Error(`Failed to load settings: ${error.message}`);
  const row = data as SettingsRow;
  return {
    deliveryFeeCents: row.delivery_fee_cents,
    freeDeliveryMinCents: row.free_delivery_min_cents ?? 0,
    minOrderCents: row.min_order_cents,
    leadTimeDays: row.lead_time_days,
    timeWindows: row.time_windows,
    blackoutDates: row.blackout_dates,
    pickupLocation: row.pickup_location_public ?? "",
    dailyOrderCap: row.daily_order_cap,
    perWindowCap: row.per_window_cap,
    dailyCutoffTime: row.daily_cutoff_time,
    freeGiftThresholdCents: row.free_gift_threshold_cents,
    freeGiftProductId: row.free_gift_product_id,
    birthdayRewardPoints: row.birthday_reward_points ?? 0,
    abandonedAfterHours: row.abandoned_after_hours ?? 4,
    notePrompts: Array.isArray(row.note_prompts) ? row.note_prompts : [],
    lowStockThreshold: row.low_stock_threshold,
    mascotMessages: parseMascotMessages(row.mascot_message),
    pointsPerDollar: row.points_per_dollar ?? 1,
    pointValueCents: row.point_value_cents ?? 5,
    referralReferrerPoints: row.referral_referrer_points ?? 50,
    referralRefereePoints: row.referral_referee_points ?? 30,
    features: rowToFeatureFlags(row as unknown as Record<string, boolean | null | undefined>),
  };
}

export async function updateSettings(patch: Partial<AdminSettings>) {
  const supabase = createAdminClient();
  const columns: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.deliveryFeeCents !== undefined) columns.delivery_fee_cents = patch.deliveryFeeCents;
  if (patch.freeDeliveryMinCents !== undefined)
    columns.free_delivery_min_cents = patch.freeDeliveryMinCents;
  if (patch.minOrderCents !== undefined) columns.min_order_cents = patch.minOrderCents;
  if (patch.leadTimeDays !== undefined) columns.lead_time_days = patch.leadTimeDays;
  if (patch.timeWindows !== undefined) columns.time_windows = patch.timeWindows;
  if (patch.blackoutDates !== undefined) columns.blackout_dates = patch.blackoutDates;
  if (patch.pickupLocation !== undefined) columns.pickup_location_public = patch.pickupLocation;
  if (patch.dailyOrderCap !== undefined) columns.daily_order_cap = patch.dailyOrderCap;
  if (patch.pointsPerDollar !== undefined) columns.points_per_dollar = patch.pointsPerDollar;
  if (patch.pointValueCents !== undefined) columns.point_value_cents = patch.pointValueCents;
  if (patch.referralReferrerPoints !== undefined)
    columns.referral_referrer_points = patch.referralReferrerPoints;
  if (patch.referralRefereePoints !== undefined)
    columns.referral_referee_points = patch.referralRefereePoints;
  if (patch.perWindowCap !== undefined) columns.per_window_cap = patch.perWindowCap;
  if (patch.dailyCutoffTime !== undefined) columns.daily_cutoff_time = patch.dailyCutoffTime;
  if (patch.mascotMessages !== undefined) {
    // Stored one message per line; null when there are none so the column stays clean.
    const cleaned = patch.mascotMessages.map((m) => m.trim()).filter(Boolean);
    columns.mascot_message = cleaned.length ? cleaned.join("\n") : null;
  }
  if (patch.freeGiftThresholdCents !== undefined)
    columns.free_gift_threshold_cents = patch.freeGiftThresholdCents;
  if (patch.freeGiftProductId !== undefined)
    columns.free_gift_product_id = patch.freeGiftProductId;
  if (patch.birthdayRewardPoints !== undefined)
    columns.birthday_reward_points = patch.birthdayRewardPoints;
  if (patch.abandonedAfterHours !== undefined)
    columns.abandoned_after_hours = patch.abandonedAfterHours;
  if (patch.notePrompts !== undefined) columns.note_prompts = patch.notePrompts;
  if (patch.lowStockThreshold !== undefined) columns.low_stock_threshold = patch.lowStockThreshold;
  if (patch.features !== undefined) {
    columns.feature_rewards = patch.features.rewards;
    columns.feature_wishlist = patch.features.wishlist;
    columns.feature_reviews = patch.features.reviews;
    columns.feature_promos = patch.features.promos;
    columns.feature_gifting = patch.features.gifting;
    columns.feature_referrals = patch.features.referrals;
    columns.feature_build_a_box = patch.features.buildABox;
    columns.feature_bundles = patch.features.bundles;
    columns.feature_spend_gift = patch.features.spendGift;
    columns.feature_back_in_stock = patch.features.backInStock;
    columns.feature_photo_reviews = patch.features.photoReviews;
    columns.feature_cart_sharing = patch.features.cartSharing;
    columns.feature_wishlist_sharing = patch.features.wishlistSharing;
    columns.feature_instagram_feed = patch.features.instagram;
    columns.feature_birthday_rewards = patch.features.birthdayRewards;
    columns.feature_abandoned_cart = patch.features.abandonedCart;
    columns.feature_structured_notes = patch.features.structuredNotes;
    columns.feature_order_changes = patch.features.orderChanges;
    columns.feature_newsletter = patch.features.newsletter;
    columns.feature_drops = patch.features.drops;
    columns.feature_dietary_prefs = patch.features.dietaryPrefs;
    columns.feature_occasion_reminders = patch.features.occasionReminders;
  }

  const { error } = await supabase.from("settings").update(columns).eq("id", 1);
  if (error) throw new Error(`Failed to update settings: ${error.message}`);
}

// ---- Promo codes -----------------------------------------------------------
// PromoDiscountType is imported from promos.ts at the top so the two can't drift.

export type PromoCode = {
  id: string;
  code: string;
  discountType: PromoDiscountType;
  discountValue: number; // percent, 1–100, or cents for a fixed amount, 0 for free_delivery
  minOrderCents: number;
  active: boolean;
  expiresAt: string | null; // ISO date as yyyy-mm-dd, or null
  maxRedemptions: number | null;
  perCustomerLimit: number | null;
  firstOrderOnly: boolean;
  /** Non-cancelled orders that have used this code. */
  redemptions: number;
};

type PromoRow = {
  id: string;
  code: string;
  discount_type: PromoDiscountType;
  discount_value: number;
  min_order_cents: number;
  active: boolean;
  expires_at: string | null;
  max_redemptions: number | null;
  per_customer_limit: number | null;
  first_order_only: boolean;
};

function toPromo(row: PromoRow, redemptions = 0): PromoCode {
  return {
    id: row.id,
    code: row.code,
    discountType: row.discount_type,
    discountValue: row.discount_value,
    minOrderCents: row.min_order_cents,
    active: row.active,
    expiresAt: row.expires_at,
    maxRedemptions: row.max_redemptions,
    perCustomerLimit: row.per_customer_limit,
    firstOrderOnly: row.first_order_only,
    redemptions,
  };
}

export async function fetchPromos(): Promise<PromoCode[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("promo_codes")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Failed to load promo codes: ${error.message}`);

  // Tally redemptions across non-cancelled orders in one pass.
  const { data: usage } = await supabase
    .from("orders")
    .select("promo_code")
    .neq("status", "cancelled")
    .not("promo_code", "is", null);
  const counts = new Map<string, number>();
  for (const row of (usage as { promo_code: string | null }[] | null) ?? []) {
    if (row.promo_code) counts.set(row.promo_code, (counts.get(row.promo_code) ?? 0) + 1);
  }

  return ((data as PromoRow[] | null) ?? []).map((row) =>
    toPromo(row, counts.get(row.code) ?? 0),
  );
}

export type NewPromo = {
  code: string;
  discountType: PromoDiscountType;
  discountValue: number;
  minOrderCents: number;
  expiresAt: string | null;
  maxRedemptions: number | null;
  perCustomerLimit: number | null;
  firstOrderOnly: boolean;
};

export async function createPromo(input: NewPromo): Promise<PromoCode> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("promo_codes")
    .insert({
      code: input.code.trim().toUpperCase(),
      discount_type: input.discountType,
      discount_value: input.discountValue,
      min_order_cents: input.minOrderCents,
      expires_at: input.expiresAt,
      max_redemptions: input.maxRedemptions,
      per_customer_limit: input.perCustomerLimit,
      first_order_only: input.firstOrderOnly,
      active: true,
    })
    .select("*")
    .single();
  if (error) {
    // 23505 = unique_violation, the code already exists
    if ((error as { code?: string }).code === "23505") {
      throw new Error("A code with that name already exists.");
    }
    throw new Error(`Failed to create promo code: ${error.message}`);
  }
  return toPromo(data as PromoRow);
}

export async function setPromoActive(id: string, active: boolean) {
  const supabase = createAdminClient();
  const { error } = await supabase.from("promo_codes").update({ active }).eq("id", id);
  if (error) throw new Error(`Failed to update promo code: ${error.message}`);
}

export async function deletePromo(id: string) {
  const supabase = createAdminClient();
  const { error } = await supabase.from("promo_codes").delete().eq("id", id);
  if (error) throw new Error(`Failed to delete promo code: ${error.message}`);
}
