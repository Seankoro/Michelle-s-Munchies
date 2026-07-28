import "server-only";
import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  sendStatusEmail,
  sendLowStockEmail,
  sendReviewRequestEmail,
  sendRescheduleEmail,
} from "@/lib/email";
import { notifySubscribers } from "@/lib/stock-notify";
import { fetchStoreSettings, parseMascotMessages } from "@/lib/settings";
import { rowToFeatureFlags } from "@/lib/feature-flags";
import { refundOrder } from "@/lib/payments";
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
  deposit_cents: number | null;
  subtotal_cents: number;
  delivery_fee_cents: number;
  total_cents: number;
  created_at: string;
  order_items: OrderItemRow[] | null;
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
    depositCents: row.deposit_cents,
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
    .select("*, order_items(*)")
    .order("created_at", { ascending: false })
    .limit(ADMIN_ORDER_LIMIT);
  if (error) throw new Error(`Failed to load orders: ${error.message}`);
  return ((data as OrderRow[] | null) ?? []).map(rowToAdminOrder);
}

export async function updateOrderStatus(orderNumber: string, status: OrderStatus) {
  const supabase = createAdminClient();
  // Paid-before-baking: an order can only move into a work status once it is
  // paid. received/confirmed stay available while unpaid, and cancel is handled
  // separately, so neither is blocked here.
  if (statusRequiresPayment(status)) {
    const { data: cur } = await supabase
      .from("orders")
      .select("payment_status")
      .eq("order_number", orderNumber)
      .maybeSingle();
    if ((cur as { payment_status: PaymentStatus } | null)?.payment_status !== "paid") {
      throw new Error("Mark this order paid before moving it to baking or beyond.");
    }
  }
  const { error } = await supabase
    .from("orders")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("order_number", orderNumber);
  if (error) throw new Error(`Failed to update status: ${error.message}`);

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
  // Reaching "paid" must run the same side effects as a Stripe payment: award
  // loyalty points, deduct any the customer redeemed, decrement tracked stock,
  // and reward referrals. PayNow orders are marked paid here by hand, not by a
  // webhook, so without this those never fire and redeemed points could be
  // re-spent forever. markOrderPaid guards the transition, so it is idempotent.
  if (paymentStatus === "paid") {
    await markOrderPaid(orderNumber, null);
    return;
  }
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("orders")
    .update({ payment_status: paymentStatus, updated_at: new Date().toISOString() })
    .eq("order_number", orderNumber);
  if (error) throw new Error(`Failed to update payment: ${error.message}`);
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

/** Record a deposit already collected on an order. 0 clears it back to null. */
export async function recordDeposit(orderNumber: string, cents: number) {
  const supabase = createAdminClient();
  const value = cents > 0 ? Math.round(cents) : null;
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

/** Add ordered quantities back to any tracked product, reversing a paid decrement. */
async function restockOrder(orderId: string) {
  const supabase = createAdminClient();
  // Only restock if stock was actually taken, and only once. Clearing the
  // decrement stamp atomically means a re-cancel can't add the same units back
  // twice, and an order that never decremented (unpaid) is a no-op.
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
    await supabase.rpc("adjust_product_stock", { p_id: item.product_id, p_delta: item.quantity });
  }
}

export type CancelResult = { ok: true; refunded: boolean } | { ok: false; error: string };

/**
 * Admin cancel and refund. Idempotent, so a cancelled order is a no-op. If the
 * order was paid, refunds the Stripe PaymentIntent and restocks, then marks the
 * order cancelled, and refunded when money was returned.
 */
export async function cancelAndRefundOrder(orderNumber: string): Promise<CancelResult> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("orders")
    .select("id, status, payment_status, stripe_payment_intent_id")
    .eq("order_number", orderNumber)
    .maybeSingle();
  if (error || !data) return { ok: false, error: "Order not found." };
  const order = data as {
    id: string;
    status: string;
    payment_status: string;
    stripe_payment_intent_id: string | null;
  };
  if (order.status === "cancelled") return { ok: true, refunded: order.payment_status === "refunded" };

  let refunded = false;
  if (order.payment_status === "paid" && order.stripe_payment_intent_id) {
    refunded = await refundOrder(order.stripe_payment_intent_id);
    if (!refunded) {
      // The card refund did not go through. Leave the order untouched rather than
      // cancelling it into a paid-but-unrefunded state, so the customer's money is
      // not stranded and the admin can retry the cancel.
      return {
        ok: false,
        error: "The Stripe refund did not go through, so the order was not cancelled. Please try again in a moment.",
      };
    }
  }
  // Put stock back for any order that took it, however it was paid (Stripe card
  // OR a PayNow/manual order marked paid here). restockOrder self-guards on the
  // decrement stamp, so it is a no-op for orders that never touched stock.
  await restockOrder(order.id);
  const { error: updErr } = await supabase
    .from("orders")
    .update({
      status: "cancelled",
      payment_status: refunded ? "refunded" : order.payment_status,
      updated_at: new Date().toISOString(),
    })
    .eq("id", order.id);
  if (updErr) return { ok: false, error: updErr.message };
  return { ok: true, refunded };
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
      stripe_payment_intent_id: paymentIntentId,
      updated_at: new Date().toISOString(),
    })
    .eq("order_number", orderNumber)
    .neq("payment_status", "paid")
    .select("id, user_id, subtotal_cents, points_redeemed")
    .maybeSingle();
  if (error) throw new Error(`Failed to mark order paid: ${error.message}`);
  if (!data) return; // already paid from a duplicate webhook, or not found

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
      const { error: redeemError } = await supabase.from("points_ledger").insert({
        user_id: order.user_id,
        order_id: order.id,
        delta: -order.points_redeemed,
        reason: "redeemed",
      });
      if (redeemError && redeemError.code !== "23505") {
        console.error(`[points] Failed to deduct for ${orderNumber}:`, redeemError.message);
      }
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
        // The unique index on order_id where reason='earned' makes retries safe.
        const { error: ledgerError } = await supabase.from("points_ledger").insert({
          user_id: order.user_id,
          order_id: order.id,
          delta: points,
          reason: "earned",
        });
        if (ledgerError && ledgerError.code !== "23505") {
          console.error(`[points] Failed to award for ${orderNumber}:`, ledgerError.message);
        }
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
  const { data, error } = await supabase
    .from("products")
    .insert(toProductColumns(product))
    .select("id, slug")
    .single();
  if (error) throw new Error(`Failed to create product: ${error.message}`);
  const id = (data as { id: string }).id;
  const options = await replaceProductOptions(supabase, id, product.options ?? []);
  return { ...product, id, options };
}

export async function updateProduct(id: string, patch: Partial<Product>) {
  const supabase = createAdminClient();
  const columns = toProductColumns(patch);
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
  // When a product is switched back to available, email anyone waiting for it.
  if (patch.isAvailable === true) {
    await notifySubscribers(id);
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
