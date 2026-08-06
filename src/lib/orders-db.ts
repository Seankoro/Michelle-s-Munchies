import "server-only";
import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { newToken } from "@/lib/tokens";
import { createPublicClient } from "@/lib/supabase/public";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendOrderEmails } from "@/lib/email";
import { fetchStoreSettings } from "@/lib/settings";
import {
  computeDeliveryFeeCents,
  generateOrderNumber,
  type DeliveryAddress,
  type FulfillmentType,
  type OrderStatus,
  type PaymentStatus,
} from "@/lib/order";
import type { CartItem, NoteAnswer, SelectedOption } from "@/lib/types";
import { resolveDeliveryFeeCents } from "@/lib/delivery-pricing";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type CreateOrderInput = {
  items: CartItem[];
  fulfillmentType: FulfillmentType;
  scheduledDate: string;
  timeWindow: string;
  address?: DeliveryAddress;
  name: string;
  email: string;
  phone: string;
  notes?: string;
  isGift?: boolean;
  giftMessage?: string;
  recipientName?: string;
  recipientPhone?: string;
  /** Gift only: let the recipient fill in their own address and time window. */
  recipientScheduling?: boolean;
  noteAnswers?: NoteAnswer[];
  /** Authoritative delivery fee resolved by the caller (distance-zoned at
   *  checkout). When omitted, the flat fee from settings is used. */
  deliveryFeeCents?: number;
};

export type CreatedOrder = {
  orderNumber: string;
  trackingToken: string;
  deliveryFeeCents: number;
  discountCents: number;
  /** Set only when the buyer chose to let the recipient self-schedule. */
  recipientToken: string | null;
};

export type OrderRedemption = { pointsRedeemed: number; discountCents: number };

/** Daily and per-window order caps, enforced atomically inside the insert RPC. */
/**
 * The limits the insert re-asserts under a lock. Capacity is per bake date; the
 * promo caps come from the promo row. Counting these in the action and inserting
 * afterwards let simultaneous checkouts each pass the same check, so the real
 * enforcement lives in the database function and these are what it enforces.
 */
export type OrderCapacity = {
  dailyCap: number | null;
  windowCap: number | null;
  promoMaxRedemptions?: number | null;
  promoPerCustomerLimit?: number | null;
};

/**
 * A first-order-only promo is a per-customer cap of one, so hand the insert that
 * cap and its lock does the work.
 *
 * 0039 moved the global and per-customer promo caps and the points balance
 * inside create_order_with_items, under an advisory lock keyed on the code, but
 * first_order_only stayed behind in validatePromo, which counts the customer's
 * existing orders and then returns. Two checkouts fired at once by a brand-new
 * account both read a count of zero and both spend a code meant for one order.
 *
 * The insert function has no first-order rule of its own and the migration is
 * not ours to change here, but "this customer may hold at most one non-cancelled
 * order carrying this code" is exactly the per-customer cap it already enforces,
 * against the same person, under the same lock. Any looser cap on the promo row
 * is subsumed by it, since a first order is one order. So the tightened cap is
 * the answer whenever the row says first_order_only, and the loser of the race
 * comes back as promo_customer_cap, which the checkout action already turns into
 * the used-up copy.
 *
 * Read from the promo row rather than passed in, so no caller can forget it.
 */
async function promoPerCustomerLimitFor(
  supabase: ReturnType<typeof createAdminClient>,
  promoCode: string,
  callerLimit: number | null,
): Promise<number | null> {
  const { data } = await supabase
    .from("promo_codes")
    .select("first_order_only")
    .eq("code", promoCode)
    .maybeSingle();
  const firstOrderOnly = (data as { first_order_only: boolean } | null)?.first_order_only ?? false;
  return firstOrderOnly ? 1 : callerLimit;
}

/**
 * Creates an order and its items. Amounts are recomputed here, never trusted
 * from the client. `userId` is resolved server-side from the session, null for
 * guests. `redemption`, the points-to-discount conversion, is computed
 * server-side in the action.
 *
 * The order row and its items are written by one Postgres function, so they
 * commit or roll back together and a fault can never leave an orphaned,
 * itemless order. That same function re-asserts every spend limit under a lock,
 * in the transaction that does the insert: the capacity caps, the promo caps,
 * and the customer's points balance. Each is raised as a marker
 * (`capacity_day_full`, `capacity_window_full`, `promo_cap_reached`,
 * `promo_customer_cap`, `points_unavailable`) which the checkout action turns
 * into the same copy its own pre-checks use. Counting in the action alone let
 * simultaneous checkouts all read the same state and each spend the limit.
 *
 * A first-order-only code is handed to that same function as a per-customer cap
 * of one, which is what it means, so it races no more than the rest.
 */
export async function createOrder(
  input: CreateOrderInput,
  userId: string | null = null,
  redemption: OrderRedemption = { pointsRedeemed: 0, discountCents: 0 },
  promoCode: string | null = null,
  capacity: OrderCapacity = { dailyCap: null, windowCap: null },
): Promise<CreatedOrder> {
  if (input.items.length === 0) throw new Error("Your cart is empty.");

  // Orders are written with the server-only service role so the public anon
  // key can't insert forged orders, like a fake "paid" order, directly.
  const supabase = createAdminClient();

  const subtotalCents = input.items.reduce(
    (sum, item) => sum + item.unitPriceCents * item.quantity,
    0,
  );
  // Fee is computed from Michelle's live settings, never trusted from the client,
  // unless the caller already resolved the authoritative fee (distance-zoned at
  // checkout), in which case that value wins and this is only the fallback.
  const settings = await fetchStoreSettings();
  const deliveryFeeCents =
    input.deliveryFeeCents ??
    computeDeliveryFeeCents(subtotalCents, input.fulfillmentType, settings);
  // Clamp the discount so the charge can never go negative.
  const discountCents = Math.max(
    0,
    Math.min(redemption.discountCents, subtotalCents + deliveryFeeCents),
  );
  const totalCents = subtotalCents + deliveryFeeCents - discountCents;

  const orderId = randomUUID();
  const trackingToken = newToken();
  let orderNumber = generateOrderNumber();
  // Only a gift the buyer wants the recipient to schedule gets a recipient token.
  const recipientToken = input.isGift && input.recipientScheduling ? newToken() : null;

  const itemRows = input.items.map((item) => ({
    // Real products carry a uuid. Box and bundle lines use a prefixed id with
    // no uuid, so they store null and lean on the product_name snapshot to keep
    // the order readable.
    product_id: UUID_RE.test(item.productId) ? item.productId : null,
    product_name: item.name,
    unit_price_cents: item.unitPriceCents,
    quantity: item.quantity,
    selected_options: item.selectedOptions,
    personalisation: item.personalisation ?? null,
    line_total_cents: item.unitPriceCents * item.quantity,
  }));

  // A first-order-only code needs the per-customer cap tightened to one before
  // the insert re-asserts it, since that is the only lock standing between two
  // simultaneous checkouts and the same one-per-customer code.
  const promoPerCustomerLimit = promoCode
    ? await promoPerCustomerLimitFor(supabase, promoCode, capacity.promoPerCustomerLimit ?? null)
    : null;

  // Retry a couple of times on an order-number collision, regenerating the
  // random suffix, so two orders drawing the same number on the same day never
  // surface as a hard failure to the customer.
  const MAX_INSERT_ATTEMPTS = 3;
  for (let attempt = 1; ; attempt++) {
    const { error } = await supabase.rpc("create_order_with_items", {
      p_order: {
        id: orderId,
        order_number: orderNumber,
        tracking_token: trackingToken,
        recipient_token: recipientToken,
        user_id: userId,
        fulfillment_type: input.fulfillmentType,
        scheduled_date: input.scheduledDate,
        time_window: input.timeWindow,
        delivery_address: input.address ?? null,
        customer_name: input.name,
        email: input.email,
        phone: input.phone,
        notes: input.notes ?? null,
        is_gift: input.isGift ?? false,
        gift_message: input.isGift ? (input.giftMessage?.trim() || null) : null,
        recipient_name: input.isGift ? (input.recipientName?.trim() || null) : null,
        recipient_phone: input.isGift ? (input.recipientPhone?.trim() || null) : null,
        subtotal_cents: subtotalCents,
        delivery_fee_cents: deliveryFeeCents,
        discount_cents: discountCents,
        points_redeemed: discountCents > 0 ? redemption.pointsRedeemed : 0,
        promo_code: promoCode,
        note_answers: input.noteAnswers ?? [],
        total_cents: totalCents,
        currency: "SGD",
      },
      p_items: itemRows,
      p_daily_cap: capacity.dailyCap,
      p_window_cap: capacity.windowCap,
      p_promo_max_redemptions: capacity.promoMaxRedemptions ?? null,
      p_promo_per_customer_limit: promoPerCustomerLimit,
    });
    if (!error) break;
    // Every limit the function re-asserts raises its own marker for the action
    // to translate into the copy the customer already sees from the pre-checks.
    for (const marker of [
      "capacity_day_full",
      "capacity_window_full",
      "promo_cap_reached",
      "promo_customer_cap",
      "points_unavailable",
    ]) {
      if (error.message.includes(marker)) throw new Error(marker);
    }
    if (error.code === "23505" && attempt < MAX_INSERT_ATTEMPTS) {
      orderNumber = generateOrderNumber();
      continue;
    }
    throw new Error(`Could not create order: ${error.message}`);
  }

  // Confirmation to the customer and alert to Michelle. Never throws. The order
  // row is already committed, so these run after the response rather than
  // holding the customer on a spinner: a slow email provider must never make a
  // placed order look like it failed, or they place the whole thing again.
  after(() =>
    sendOrderEmails({
      orderNumber,
      trackingToken,
      name: input.name,
      email: input.email,
      items: input.items,
      subtotalCents,
      deliveryFeeCents,
      discountCents,
      promoCode,
      totalCents,
      fulfillmentType: input.fulfillmentType,
      scheduledDate: input.scheduledDate,
      timeWindow: input.timeWindow,
      isGift: input.isGift ?? false,
      giftMessage: input.isGift ? input.giftMessage?.trim() || undefined : undefined,
      recipientName: input.isGift ? input.recipientName?.trim() || undefined : undefined,
      noteAnswers: input.noteAnswers ?? [],
    }),
  );

  return { orderNumber, trackingToken, deliveryFeeCents, discountCents, recipientToken };
}

export type ManualOrderInput = {
  items: {
    productId: string;
    name: string;
    unitPriceCents: number;
    quantity: number;
    selectedOptions: SelectedOption[];
  }[];
  fulfillmentType: FulfillmentType;
  scheduledDate: string;
  timeWindow: string;
  name: string;
  phone: string;
  email: string;
  notes?: string;
  address?: DeliveryAddress;
};

/**
 * Log an order taken off-app (a WhatsApp or phone order) straight into the
 * system so it flows into the bake list, packing slips, and Insights. Uses the
 * service-role client and is admin-gated in the action. No customer emails
 * fire, since Michelle is already talking to them; payment starts pending so
 * marking it paid later runs the normal side effects.
 */
export async function createManualOrder(input: ManualOrderInput): Promise<{ orderNumber: string }> {
  if (input.items.length === 0) throw new Error("Add at least one item.");
  const supabase = createAdminClient();

  const subtotalCents = input.items.reduce(
    (sum, item) => sum + item.unitPriceCents * item.quantity,
    0,
  );
  const settings = await fetchStoreSettings();
  // Price delivery the same way online checkout does, distance-zoned when the
  // address has a postal code and zones are configured, else the flat fee.
  const deliveryFeeCents = await resolveDeliveryFeeCents(
    input.fulfillmentType,
    subtotalCents,
    input.address?.postalCode,
    settings,
  );
  const totalCents = subtotalCents + deliveryFeeCents;

  const orderId = randomUUID();
  const trackingToken = newToken();
  let orderNumber = generateOrderNumber();

  const itemRows = input.items.map((item) => ({
    product_id: UUID_RE.test(item.productId) ? item.productId : null,
    product_name: item.name,
    unit_price_cents: item.unitPriceCents,
    quantity: item.quantity,
    selected_options: item.selectedOptions,
    line_total_cents: item.unitPriceCents * item.quantity,
  }));

  // Same atomic insert as online checkout, minus the capacity caps: Michelle
  // is logging an order she already accepted, so she decides, not the caps.
  const MAX_INSERT_ATTEMPTS = 3;
  for (let attempt = 1; ; attempt++) {
    const { error } = await supabase.rpc("create_order_with_items", {
      p_order: {
        id: orderId,
        order_number: orderNumber,
        tracking_token: trackingToken,
        recipient_token: null,
        user_id: null,
        fulfillment_type: input.fulfillmentType,
        scheduled_date: input.scheduledDate,
        time_window: input.timeWindow,
        delivery_address: input.fulfillmentType === "delivery" ? input.address ?? null : null,
        customer_name: input.name,
        email: input.email.trim(),
        phone: input.phone.trim(),
        notes: input.notes?.trim() || null,
        is_gift: false,
        gift_message: null,
        recipient_name: null,
        recipient_phone: null,
        subtotal_cents: subtotalCents,
        delivery_fee_cents: deliveryFeeCents,
        discount_cents: 0,
        points_redeemed: 0,
        promo_code: null,
        note_answers: [],
        total_cents: totalCents,
        currency: "SGD",
      },
      p_items: itemRows,
      // No caps at all: Michelle is logging an order she already accepted, so
      // she decides, not the limits. A manual order carries no promo and no
      // points either, so there is nothing for those guards to check.
      p_daily_cap: null,
      p_window_cap: null,
      p_promo_max_redemptions: null,
      p_promo_per_customer_limit: null,
    });
    if (!error) break;
    if (error.code === "23505" && attempt < MAX_INSERT_ATTEMPTS) {
      orderNumber = generateOrderNumber();
      continue;
    }
    throw new Error(`Could not create order: ${error.message}`);
  }

  return { orderNumber };
}

export type TrackedOrderItem = {
  product_name: string;
  unit_price_cents: number;
  quantity: number;
  selected_options: SelectedOption[];
  personalisation: { message?: string; photoUrl?: string } | null;
  line_total_cents: number;
};

export type TrackedOrder = {
  order_number: string;
  status: OrderStatus;
  payment_status: PaymentStatus;
  fulfillment_type: FulfillmentType;
  scheduled_date: string;
  time_window: string | null;
  delivery_address: DeliveryAddress | null;
  customer_name: string;
  email: string;
  phone: string;
  notes: string | null;
  is_gift: boolean;
  gift_message: string | null;
  recipient_name: string | null;
  recipient_token: string | null;
  recipient_scheduled_at: string | null;
  subtotal_cents: number;
  delivery_fee_cents: number;
  discount_cents: number;
  promo_code: string | null;
  points_redeemed: number;
  total_cents: number;
  created_at: string;
  items: TrackedOrderItem[];
};

/** Fetch one order by its tracking token without login, via the SECURITY DEFINER RPC. */
export async function getOrderByToken(token: string): Promise<TrackedOrder | null> {
  const supabase = createPublicClient();
  const { data, error } = await supabase.rpc("get_order_by_token", { p_token: token });
  if (error) throw new Error(`Could not load order: ${error.message}`);
  return (data as TrackedOrder | null) ?? null;
}

/** What the gift recipient sees: enough to schedule, never the price or contacts. */
export type GiftView = {
  order_number: string;
  sender_name: string;
  recipient_name: string | null;
  gift_message: string | null;
  fulfillment_type: FulfillmentType;
  scheduled_date: string;
  time_window: string | null;
  delivery_address: DeliveryAddress | null;
  status: OrderStatus;
  recipient_scheduled_at: string | null;
};

/** Fetch the recipient-safe view of a gift by its recipient token, no login. */
export async function getGiftByToken(token: string): Promise<GiftView | null> {
  const supabase = createPublicClient();
  const { data, error } = await supabase.rpc("get_gift_by_token", { p_token: token });
  if (error) throw new Error(`Could not load gift: ${error.message}`);
  return (data as GiftView | null) ?? null;
}
