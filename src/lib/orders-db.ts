import "server-only";
import { randomUUID } from "node:crypto";
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

/**
 * Creates an order and its items. Amounts are recomputed here, never trusted
 * from the client. `userId` is resolved server-side from the session, null for
 * guests. `redemption`, the points-to-discount conversion, is computed
 * server-side in the action.
 */
export async function createOrder(
  input: CreateOrderInput,
  userId: string | null = null,
  redemption: OrderRedemption = { pointsRedeemed: 0, discountCents: 0 },
  promoCode: string | null = null,
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
  const orderNumber = generateOrderNumber();
  // Only a gift the buyer wants the recipient to schedule gets a recipient token.
  const recipientToken = input.isGift && input.recipientScheduling ? newToken() : null;

  const { error: orderError } = await supabase.from("orders").insert({
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
  });
  if (orderError) throw new Error(`Could not create order: ${orderError.message}`);

  const itemRows = input.items.map((item) => ({
    order_id: orderId,
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
  const { error: itemsError } = await supabase.from("order_items").insert(itemRows);
  if (itemsError) throw new Error(`Could not save order items: ${itemsError.message}`);

  // Confirmation to the customer and alert to Michelle. Never throws.
  await sendOrderEmails({
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
  });

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
  const deliveryFeeCents = computeDeliveryFeeCents(subtotalCents, input.fulfillmentType, settings);
  const totalCents = subtotalCents + deliveryFeeCents;

  const orderId = randomUUID();
  const trackingToken = newToken();
  const orderNumber = generateOrderNumber();

  const { error: orderError } = await supabase.from("orders").insert({
    id: orderId,
    order_number: orderNumber,
    tracking_token: trackingToken,
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
    subtotal_cents: subtotalCents,
    delivery_fee_cents: deliveryFeeCents,
    discount_cents: 0,
    points_redeemed: 0,
    promo_code: null,
    note_answers: [],
    total_cents: totalCents,
    currency: "SGD",
  });
  if (orderError) throw new Error(`Could not create order: ${orderError.message}`);

  const itemRows = input.items.map((item) => ({
    order_id: orderId,
    product_id: UUID_RE.test(item.productId) ? item.productId : null,
    product_name: item.name,
    unit_price_cents: item.unitPriceCents,
    quantity: item.quantity,
    selected_options: item.selectedOptions,
    line_total_cents: item.unitPriceCents * item.quantity,
  }));
  const { error: itemsError } = await supabase.from("order_items").insert(itemRows);
  if (itemsError) throw new Error(`Could not save order items: ${itemsError.message}`);

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
  deposit_cents: number | null;
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
