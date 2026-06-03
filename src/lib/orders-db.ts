import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import { createPublicClient } from "@/lib/supabase/public";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendOrderEmails } from "@/lib/email";
import { notifyOwnerNewOrder } from "@/lib/sms";
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
  noteAnswers?: NoteAnswer[];
};

export type CreatedOrder = {
  orderNumber: string;
  trackingToken: string;
  deliveryFeeCents: number;
  discountCents: number;
};

export type OrderRedemption = { pointsRedeemed: number; discountCents: number };

/**
 * Creates an order + items. Amounts are recomputed here, never trusted from the
 * client. `userId` is resolved server-side from the session (null for guests).
 * `redemption` (points → discount) is computed server-side in the action.
 */
export async function createOrder(
  input: CreateOrderInput,
  userId: string | null = null,
  redemption: OrderRedemption = { pointsRedeemed: 0, discountCents: 0 },
  promoCode: string | null = null,
): Promise<CreatedOrder> {
  if (input.items.length === 0) throw new Error("Your cart is empty.");

  // Orders are written with the service role (server-only) so the public anon
  // key can't insert forged orders (e.g. a fake "paid" order) directly.
  const supabase = createAdminClient();

  const subtotalCents = input.items.reduce(
    (sum, item) => sum + item.unitPriceCents * item.quantity,
    0,
  );
  // Fee is computed from Michelle's live settings, never trusted from the client.
  const settings = await fetchStoreSettings();
  const deliveryFeeCents = computeDeliveryFeeCents(
    subtotalCents,
    input.fulfillmentType,
    settings,
  );
  // Clamp the discount so the charge can never go negative.
  const discountCents = Math.max(
    0,
    Math.min(redemption.discountCents, subtotalCents + deliveryFeeCents),
  );
  const totalCents = subtotalCents + deliveryFeeCents - discountCents;

  const orderId = randomUUID();
  const trackingToken = randomBytes(16).toString("hex");
  const orderNumber = generateOrderNumber();

  const { error: orderError } = await supabase.from("orders").insert({
    id: orderId,
    order_number: orderNumber,
    tracking_token: trackingToken,
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
    // Live products carry a uuid; mock/admin-added ids are stored as null
    // (the product_name snapshot keeps the order readable regardless).
    product_id: UUID_RE.test(item.productId) ? item.productId : null,
    product_name: item.name,
    unit_price_cents: item.unitPriceCents,
    quantity: item.quantity,
    selected_options: item.selectedOptions,
    line_total_cents: item.unitPriceCents * item.quantity,
  }));
  const { error: itemsError } = await supabase.from("order_items").insert(itemRows);
  if (itemsError) throw new Error(`Could not save order items: ${itemsError.message}`);

  // Confirmation to the customer + alert to Michelle (never throws).
  await sendOrderEmails({
    orderNumber,
    trackingToken,
    name: input.name,
    email: input.email,
    items: input.items,
    subtotalCents,
    deliveryFeeCents,
    totalCents,
    fulfillmentType: input.fulfillmentType,
    scheduledDate: input.scheduledDate,
    timeWindow: input.timeWindow,
    isGift: input.isGift ?? false,
    giftMessage: input.isGift ? input.giftMessage?.trim() || undefined : undefined,
    recipientName: input.isGift ? input.recipientName?.trim() || undefined : undefined,
    noteAnswers: input.noteAnswers ?? [],
  });

  // Text Michelle the moment it lands (no-op until Twilio is configured).
  await notifyOwnerNewOrder({
    orderNumber,
    name: input.name,
    totalCents,
    fulfillmentType: input.fulfillmentType,
    isGift: input.isGift ?? false,
  });

  return { orderNumber, trackingToken, deliveryFeeCents, discountCents };
}

export type TrackedOrderItem = {
  product_name: string;
  unit_price_cents: number;
  quantity: number;
  selected_options: SelectedOption[];
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
  subtotal_cents: number;
  delivery_fee_cents: number;
  total_cents: number;
  created_at: string;
  items: TrackedOrderItem[];
};

/** Fetch one order by its tracking token (no login), via the SECURITY DEFINER RPC. */
export async function getOrderByToken(token: string): Promise<TrackedOrder | null> {
  const supabase = createPublicClient();
  const { data, error } = await supabase.rpc("get_order_by_token", { p_token: token });
  if (error) throw new Error(`Could not load order: ${error.message}`);
  return (data as TrackedOrder | null) ?? null;
}
