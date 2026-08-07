"use server";

import * as Sentry from "@sentry/nextjs";
import { createOrder, type CreateOrderInput } from "@/lib/orders-db";
import { createCheckoutSession } from "@/lib/payments";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { computeDeliveryFeeCents, earliestFulfillmentDate } from "@/lib/order";
import { singaporeNow } from "@/lib/time";
import { fetchStoreSettings, type FeatureFlags } from "@/lib/settings";
import { resolveDeliveryFeeCents } from "@/lib/delivery-pricing";
import { formatPrice } from "@/lib/catalog";
import { rateLimit } from "@/lib/rate-limit";
import { validatePromo, type PromoValidation } from "@/lib/promos";
import { fetchBundleBySlug, validateBundleForCheckout } from "@/lib/bundles";
import { fetchBoxBySlug, validateBoxForCheckout, validateFlavourBoxForCheckout } from "@/lib/boxes";
import { fetchProductById, fetchProducts } from "@/lib/products";
import type { BoxTemplate, CartItem, SelectedOption } from "@/lib/types";
import { recordIntent, markConverted } from "@/lib/checkout-intents";
import { resolveCartLines } from "@/lib/cart-resolve";
import { EMAIL_RE } from "@/lib/text";
import { normalizeSgPhone } from "@/lib/phone";

export type PlaceOrderResult =
  | { ok: true; redirectUrl: string }
  | { ok: false; error: string };

/** Distinct treats one order may carry. Far above a real cart, and only here to
 *  stop a direct POST parking an unbounded list on the admin panel. */
const MAX_ORDER_LINES = 50;
/** Room for a real answer to one of Michelle's checkout questions, no more. */
const MAX_NOTE_ANSWER_LENGTH = 500;

/**
 * How full a chosen date is, so the checkout can show slots-left and grey out a
 * full time window before the customer fills the whole form. Counts non-cancelled
 * orders; the client already has the caps from settings, so only counts are sent.
 */
export type DayCapacity = {
  dayCount: number;
  windowCounts: Record<string, number>;
  dailyOrderCap: number | null;
  perWindowCap: number | null;
};

export async function getDayCapacityAction(date: string): Promise<DayCapacity> {
  const settings = await fetchStoreSettings();
  const empty: DayCapacity = {
    dayCount: 0,
    windowCounts: {},
    dailyOrderCap: settings.dailyOrderCap,
    perWindowCap: settings.perWindowCap,
  };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return empty;
  // Public and unauthenticated, so rate-limit it to stop it being walked to probe
  // order volume by date through the service-role count.
  if (!(await rateLimit("day-capacity", { limit: 60, windowMs: 5 * 60_000 }))) return empty;
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("orders")
    .select("time_window")
    .eq("scheduled_date", date)
    .neq("status", "cancelled");
  const rows = (data as { time_window: string | null }[] | null) ?? [];
  const windowCounts: Record<string, number> = {};
  for (const row of rows) {
    if (row.time_window) windowCounts[row.time_window] = (windowCounts[row.time_window] ?? 0) + 1;
  }
  return { ...empty, dayCount: rows.length, windowCounts };
}

function subtotalOf(items: CreateOrderInput["items"]): number {
  return items.reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0);
}

/**
 * The signed-in customer's redeemable points, with points held by their other
 * unpaid orders already subtracted, so the checkout preview matches what
 * placeOrder will actually grant. Guests get 0.
 */
export async function getPointsBalanceAction(): Promise<{ balance: number }> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { balance: 0 };
  const { data: ledger } = await supabase
    .from("points_ledger")
    .select("delta")
    .eq("user_id", user.id);
  const total = ((ledger as { delta: number }[] | null) ?? []).reduce((sum, e) => sum + e.delta, 0);
  const admin = createAdminClient();
  const { data: heldRows } = await admin
    .from("orders")
    .select("points_redeemed")
    .eq("user_id", user.id)
    .in("payment_status", ["pending", "failed"])
    .neq("status", "cancelled");
  const held = ((heldRows as { points_redeemed: number }[] | null) ?? []).reduce(
    (sum, o) => sum + (o.points_redeemed ?? 0),
    0,
  );
  return { balance: Math.max(0, total - held) };
}

/** Checkout "delivery fee" preview, called as the customer fills in their postal
 *  code and cart, so the UI can show the real distance-zoned fee before placing
 *  the order. Rate-limited since it triggers a geocode/distance lookup. */
export async function estimateDeliveryFeeAction(
  postalCode: string,
  subtotalCents: number,
): Promise<{ feeCents: number }> {
  if (!(await rateLimit("delivery-estimate", { limit: 30, windowMs: 5 * 60_000 }))) {
    const settings = await fetchStoreSettings();
    return { feeCents: computeDeliveryFeeCents(subtotalCents, "delivery", settings) };
  }
  try {
    const settings = await fetchStoreSettings();
    const feeCents = await resolveDeliveryFeeCents("delivery", subtotalCents, postalCode, settings);
    return { feeCents };
  } catch {
    try {
      const settings = await fetchStoreSettings();
      return { feeCents: computeDeliveryFeeCents(subtotalCents, "delivery", settings) };
    } catch {
      return { feeCents: 0 };
    }
  }
}

/**
 * Group repeated picks into "2× Chocolate" rows the way the box pickers do, so
 * what the bake list and packing slip show is built from the picks the server
 * validated, not from a list the client sent alongside them.
 */
function pickRows(optionName: string, labels: string[]): SelectedOption[] {
  const counts = new Map<string, number>();
  for (const label of labels) counts.set(label, (counts.get(label) ?? 0) + 1);
  return [...counts].map(([label, quantity]) => ({
    optionName,
    valueLabel: `${quantity}× ${label}`,
    priceDeltaCents: 0,
  }));
}

/**
 * A special line rebuilt around what the server just validated. The quantity and
 * the cart key stay as sent, while the name, the contents, and the price come
 * from the database. Nothing here is personalisable, so a personalisation the
 * request carried is dropped rather than passed on as an instruction.
 */
function specialLine(
  item: CartItem,
  name: string,
  selectedOptions: SelectedOption[],
  unitPriceCents: number,
): CartItem {
  return { ...item, name, selectedOptions, unitPriceCents, personalisation: undefined };
}

/** One build-a-box pick, `productId` or `productId~flavour`, named the way
 *  BoxBuilder names it, so the order reads like the page it was built on. */
function boxPickLabel(box: BoxTemplate, pick: string): string {
  const separator = pick.indexOf("~");
  const productId = separator === -1 ? pick : pick.slice(0, separator);
  const flavour = separator === -1 ? "" : pick.slice(separator + 1);
  const name = box.eligibleProducts.find((p) => p.id === productId)?.name ?? "Treat";
  return flavour ? `${flavour} ${name}` : name;
}

/**
 * Re-validate and authoritatively re-price "special" cart lines server-side,
 * meaning bundles and build-a-box lines. The client-sent price and contents are
 * never trusted. The DB price wins, and unavailable items are rejected.
 *
 * The name and the contents are rebuilt from the database too. An order line for
 * one of these carries no product id, so its name is the only record of what was
 * bought, and Michelle bakes from that name on the bake list and packing slip.
 */
async function sanitizeSpecialLines(
  items: CreateOrderInput["items"],
  features: FeatureFlags,
): Promise<{ ok: true; items: CreateOrderInput["items"] } | { ok: false; error: string }> {
  const out: CreateOrderInput["items"] = [];
  const plain: CreateOrderInput["items"] = [];
  for (const item of items) {
    if (item.productId.startsWith("bundle:")) {
      if (!features.bundles) return { ok: false, error: "Bundles aren’t available right now." };
      const slug = item.productId.slice("bundle:".length);
      const v = await validateBundleForCheckout(slug);
      if (!v) return { ok: false, error: `“${item.name}” is no longer available.` };
      if (!v.available) {
        return { ok: false, error: `“${item.name}” has a sold-out item. Please remove it.` };
      }
      const bundle = await fetchBundleBySlug(slug);
      if (!bundle) return { ok: false, error: `“${item.name}” is no longer available.` };
      const contents = bundle.items.map((i) => ({
        optionName: "Includes",
        valueLabel: `${i.quantity}× ${i.productName}`,
        priceDeltaCents: 0,
      }));
      out.push(specialLine(item, bundle.name, contents, v.priceCents));
    } else if (item.productId.startsWith("box:")) {
      if (!features.buildABox) {
        return { ok: false, error: "Build-a-box isn’t available right now." };
      }
      const slug = item.productId.slice("box:".length);
      // Cart key encodes the picks as box::<slug>::<id|id|...>
      const flatIds = (item.key.split("::")[2] ?? "").split("|").filter(Boolean);
      const v = await validateBoxForCheckout(slug, flatIds);
      if (!v) return { ok: false, error: `“${item.name}” is no longer available.` };
      if ("error" in v) return { ok: false, error: v.error };
      const box = await fetchBoxBySlug(slug);
      if (!box) return { ok: false, error: `“${item.name}” is no longer available.` };
      const picks = pickRows(
        "Includes",
        flatIds.map((pick) => boxPickLabel(box, pick)),
      );
      out.push(specialLine(item, box.name, picks, v.priceCents));
    } else if (item.productId.startsWith("fbox:")) {
      const productId = item.productId.slice("fbox:".length);
      // Cart key encodes the picks as fbox::<productId>::<count>::<label|label|...>
      const parts = item.key.split("::");
      const count = parseInt(parts[2] ?? "", 10);
      const labels = (parts[3] ?? "").split("|").filter(Boolean);
      const v = await validateFlavourBoxForCheckout(productId, count, labels);
      if (!v) return { ok: false, error: `“${item.name}” is no longer available.` };
      if ("error" in v) return { ok: false, error: v.error };
      const product = await fetchProductById(productId);
      const size = product?.flavourBox?.sizes.find((s) => s.count === count);
      if (!product || !size) return { ok: false, error: `“${item.name}” is no longer available.` };
      out.push(
        specialLine(item, `${product.name} · ${size.label}`, pickRows(size.label, labels), v.priceCents),
      );
    } else {
      plain.push(item);
    }
  }

  // Plain catalog lines are re-resolved against the live catalog too, so a
  // deleted, sold-out, or repriced product (or a forged client price) never
  // reaches an order. Names, options, and unit prices all come from the DB.
  if (plain.length > 0) {
    const resolved = await resolveCartLines(
      plain.map((item) => ({
        productId: item.productId,
        productName: item.name,
        quantity: item.quantity,
        selections: item.selectedOptions.map((o) => ({
          optionName: o.optionName,
          valueLabel: o.valueLabel,
        })),
        personalisation: item.personalisation,
      })),
    );
    if (resolved.skipped.length > 0) {
      const names = resolved.skipped.map((s) => s.name).join(", ");
      return {
        ok: false,
        error: `${names} ${resolved.skipped.length === 1 ? "is" : "are"} no longer available. Please update your cart.`,
      };
    }
    out.push(...resolved.items);
  }
  return { ok: true, items: out };
}

/**
 * Capture a checkout intent, the cart and email, for the abandoned-cart reminder.
 * Rate-limited and feature-gated. Failures are swallowed and never block checkout.
 *
 * The item names are client-supplied and later rendered in the reminder email,
 * so they are scrubbed of anything link- or markup-shaped and capped, and each
 * recipient address is throttled on its own so the flow cannot be used to spam
 * someone else's inbox through our sending domain.
 */
export async function recordCheckoutIntentAction(
  email: string,
  items: { productId: string; quantity: number }[],
  subtotalCents: number,
): Promise<void> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!EMAIL_RE.test(normalizedEmail)) return;
  if (!(await rateLimit("checkout-intent", { limit: 20, windowMs: 5 * 60_000 }))) return;
  // Keyed on the address alone, no client IP, so the cap really is "this many
  // reminders to this inbox" rather than that many per source address.
  if (
    !(await rateLimit(`checkout-intent:${normalizedEmail}`, {
      limit: 3,
      windowMs: 60 * 60_000,
      scope: "global",
    }))
  ) {
    return;
  }
  if (!(await fetchStoreSettings()).features.abandonedCart) return;
  // Names come from the catalogue, never from the caller. This endpoint needs no
  // account and no payment, and the text it stores is rendered in a reminder
  // email sent to the address given, so accepting caller-written names made it a
  // way to mail a stranger arbitrary prose from our own sending domain. An id
  // that matches no product simply drops out, and a bundle or box line carries a
  // prefixed non-uuid id that the catalogue will not match, so it falls back to a
  // neutral label rather than anything the caller chose.
  const catalogue = await fetchProducts();
  const safeItems = (items ?? [])
    .slice(0, 15)
    .map((item) => {
      const product = catalogue.find((p) => p.id === item.productId);
      return {
        name: product?.name ?? "a treat",
        quantity: Math.max(1, Math.min(99, Math.trunc(Number(item.quantity) || 1))),
      };
    })
    .filter((item) => item.name);
  if (safeItems.length === 0) return;
  await recordIntent(normalizedEmail, safeItems, Math.max(0, Math.trunc(subtotalCents) || 0));
}

/** Look up the spend-gift product, returned only if it still exists and is available. */
async function fetchGiftLine(productId: string): Promise<{ name: string; slug: string } | null> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("products")
    .select("name, slug, is_available")
    .eq("id", productId)
    .maybeSingle();
  const row = data as { name: string; slug: string; is_available: boolean } | null;
  if (!row || !row.is_available) return null;
  return { name: row.name, slug: row.slug };
}

/** Checkout "Apply code", validates a promo against the current subtotal and
 *  context. `email` is what the customer has typed into the form so far, so a
 *  guest's per-customer cap is checked here and not only when they place the
 *  order. Blank until they have filled it in, which is fine, placeOrder always
 *  re-validates with the real address. */
export async function applyPromo(
  code: string,
  subtotalCents: number,
  deliveryFeeCents = 0,
  email = "",
): Promise<PromoValidation> {
  // Throttle to deter promo-code guessing.
  if (!(await rateLimit("apply-promo", { limit: 20, windowMs: 5 * 60_000 }))) {
    return { ok: false, error: "Too many tries. Please wait a few minutes." };
  }
  if (!(await fetchStoreSettings()).features.promos) {
    return { ok: false, error: "Promo codes aren’t available right now." };
  }
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return validatePromo(code, subtotalCents, { userId: user?.id ?? null, email, deliveryFeeCents });
}

/**
 * Creates the order server-side. Discounts from the promo code and rewards
 * points are recomputed authoritatively here, never trusted from the client,
 * combined into one amount, and applied via a single Stripe coupon.
 */
export async function placeOrder(
  input: CreateOrderInput,
  redeemPoints = false,
  promoCode = "",
): Promise<PlaceOrderResult> {
  try {
    if (!(await rateLimit("place-order", { limit: 12, windowMs: 5 * 60_000 }))) {
      return { ok: false, error: "Too many orders in a short time. Please wait a moment." };
    }
    // Placing an order emails the address typed into the form, and the order
    // carries free text (name, notes, gift message) that ends up in that email.
    // Without a cap keyed on the address alone, anyone could use checkout to
    // send repeated, attacker-worded mail to a stranger's inbox from the
    // bakery's own authenticated domain. Every other send path already has this
    // bucket; this was the one that missed it. Keyed with no client IP, so
    // rotating the source address does not buy a fresh allowance.
    const orderEmail = input.email.trim().toLowerCase();
    if (
      EMAIL_RE.test(orderEmail) &&
      !(await rateLimit(`place-order:${orderEmail}`, {
        limit: 5,
        windowMs: 60 * 60_000,
        scope: "global",
      }))
    ) {
      return {
        ok: false,
        error: "Too many orders for that email address just now. Please wait a little and try again.",
      };
    }
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    // Authoritative scheduling and fee rules come from Michelle's live settings.
    // The client's copy is only for display and is never trusted here.
    const settings = await fetchStoreSettings();

    // Validate contact details server-side too, since the client checks these but a
    // request can be POSTed directly. Phone is normalized to "+65 XXXX XXXX".
    if (!EMAIL_RE.test((input.email ?? "").trim())) {
      return { ok: false, error: "Enter a valid email." };
    }
    const normalizedPhone = normalizeSgPhone(input.phone ?? "");
    if (!normalizedPhone) {
      return { ok: false, error: "Enter a Singapore mobile number, e.g. 9123 4567." };
    }
    const giftingRecipientPhone = input.isGift ? input.recipientPhone?.trim() : "";
    const normalizedRecipientPhone = giftingRecipientPhone
      ? normalizeSgPhone(giftingRecipientPhone)
      : null;
    if (giftingRecipientPhone && !normalizedRecipientPhone) {
      return { ok: false, error: "Enter a valid Singapore mobile number for the recipient." };
    }

    // Every free-text field the order carries, bounded here rather than only by
    // the form's own maxLength. This is a public POST endpoint, so a direct
    // request skips the form entirely, and these values go two places that make
    // that matter: the confirmation email, sent to whatever address the request
    // names, and the admin panel, which loads every order on every mount. Left
    // unbounded, one request could mail a stranger arbitrary prose from our own
    // sending domain, or park enough text on an order to make the panel unusable
    // with no way to delete it from inside the app.
    //
    // Rejecting rather than trimming, so a real customer who overruns is told
    // which field to shorten instead of silently losing the end of it.
    const overLimit = (value: string | undefined, max: number) =>
      (value ?? "").trim().length > max;
    if (
      overLimit(input.name, 80) ||
      overLimit(input.notes, 500) ||
      overLimit(input.giftMessage, 200) ||
      overLimit(input.recipientName, 80) ||
      overLimit(input.address?.line1, 120) ||
      overLimit(input.address?.unit, 40)
    ) {
      return {
        ok: false,
        error: "One of those fields is too long. Please shorten it and try again.",
      };
    }
    if (!(input.name ?? "").trim()) {
      return { ok: false, error: "Enter your name." };
    }
    if (input.items.length > MAX_ORDER_LINES) {
      return { ok: false, error: "That is too many different treats for one order." };
    }

    // Re-validate and re-price special lines like bundles and boxes on the server.
    const sanitized = await sanitizeSpecialLines(input.items, settings.features);
    if (!sanitized.ok) return { ok: false, error: sanitized.error };
    let items = sanitized.items;

    // Quantities come from the client cart, and a forged request could send a
    // negative, fractional, or absurd quantity that corrupts the subtotal, the
    // bake list, and analytics. The UI only ever sends whole numbers from 1, so
    // reject anything outside that range server-side.
    const badQuantity = items.find(
      (i) => !Number.isInteger(i.quantity) || i.quantity < 1 || i.quantity > 99,
    );
    if (badQuantity) {
      return {
        ok: false,
        error: `We can only take 99 of ${badQuantity.name} on one order. Please lower that line, or message us for a bigger batch.`,
      };
    }

    // Block items that haven't launched yet, the seasonal drops. Server-enforced.
    if (settings.features.drops) {
      const uuidRe = /^[0-9a-f-]{36}$/i;
      const productIds = items.map((i) => i.productId).filter((id) => uuidRe.test(id));
      if (productIds.length > 0) {
        const admin = createAdminClient();
        const { data: notLive } = await admin
          .from("products")
          .select("name")
          .in("id", productIds)
          .gt("available_from", new Date().toISOString());
        const rows = notLive as { name: string }[] | null;
        if (rows && rows.length > 0) {
          return {
            ok: false,
            error: `“${rows[0].name}” hasn’t launched yet. Join the waitlist instead.`,
          };
        }
      }
    }

    const subtotalCents = subtotalOf(items);

    // Spend-gift, append a free gift line once the cart clears the threshold.
    if (
      settings.features.spendGift &&
      settings.freeGiftThresholdCents &&
      settings.freeGiftProductId &&
      subtotalCents >= settings.freeGiftThresholdCents
    ) {
      const giftKey = `gift::${settings.freeGiftProductId}`;
      if (!items.some((i) => i.key === giftKey)) {
        const gift = await fetchGiftLine(settings.freeGiftProductId);
        if (gift) {
          items = [
            ...items,
            {
              key: giftKey,
              productId: settings.freeGiftProductId,
              slug: gift.slug,
              name: `${gift.name} (free gift) 🎁`,
              unitPriceCents: 0,
              quantity: 1,
              selectedOptions: [],
            },
          ];
        }
      }
    }

    // A gift the recipient will self-schedule legitimately has no address or time
    // window yet; every other order must supply both, checked here because the
    // client validation can be bypassed by a direct POST. Only a delivery gift
    // can be self-scheduled, since what the recipient fills in is their own
    // address, so a pickup order can't claim to be one and skip the checks. The
    // checkout form offers it on the same terms.
    const giftSelfSchedule = Boolean(
      settings.features.gifting &&
        input.isGift &&
        input.recipientScheduling &&
        input.fulfillmentType === "delivery",
    );
    if (input.fulfillmentType === "delivery" && !giftSelfSchedule) {
      const postal = input.address?.postalCode?.trim() ?? "";
      if (!input.address?.line1?.trim() || !/^\d{6}$/.test(postal)) {
        return { ok: false, error: "Enter a delivery address with a 6-digit postal code." };
      }
    }
    if (!giftSelfSchedule && (!input.timeWindow || !settings.timeWindows.includes(input.timeWindow))) {
      return { ok: false, error: "Please choose a time window." };
    }
    // The recipient chooses the window later, so a self-scheduled gift stores
    // none. Anything the request carried was never checked against the
    // allowlist above and must not reach the order or the bake list.
    const timeWindow = giftSelfSchedule ? "" : input.timeWindow;

    const deliveryFeeCents = await resolveDeliveryFeeCents(
      input.fulfillmentType,
      subtotalCents,
      input.address?.postalCode,
      settings,
    );

    if (subtotalCents < settings.minOrderCents) {
      return { ok: false, error: `Minimum order is ${formatPrice(settings.minOrderCents)}.` };
    }
    const earliest = earliestFulfillmentDate(
      settings.leadTimeDays,
      singaporeNow(),
      settings.dailyCutoffTime,
    );
    if (!input.scheduledDate || input.scheduledDate < earliest) {
      return { ok: false, error: "Please choose a later date. We bake to order." };
    }
    if (settings.blackoutDates.includes(input.scheduledDate)) {
      return { ok: false, error: "We’re away that day. Please choose another date." };
    }
    // Daily order cap, where null or 0 means unlimited. Counted with the service-role
    // client since orders aren't publicly readable.
    if (settings.dailyOrderCap && settings.dailyOrderCap > 0) {
      const admin = createAdminClient();
      const { count } = await admin
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("scheduled_date", input.scheduledDate)
        .neq("status", "cancelled");
      if ((count ?? 0) >= settings.dailyOrderCap) {
        return { ok: false, error: "That date is fully booked. Please pick another." };
      }
    }
    // Per-time-window cap, where null or 0 means unlimited.
    if (settings.perWindowCap && settings.perWindowCap > 0 && timeWindow) {
      const admin = createAdminClient();
      const { count } = await admin
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("scheduled_date", input.scheduledDate)
        .eq("time_window", timeWindow)
        .neq("status", "cancelled");
      if ((count ?? 0) >= settings.perWindowCap) {
        return { ok: false, error: "That time slot is fully booked. Please pick another window." };
      }
    }

    // Always keep at least S$0.50 chargeable.
    let room = Math.max(0, subtotalCents + deliveryFeeCents - 50);

    // Promo code, validated server-side and available to guests too.
    let promoDiscount = 0;
    let appliedPromo: string | null = null;
    let promoMaxRedemptions: number | null = null;
    let promoPerCustomerLimit: number | null = null;
    if (promoCode.trim()) {
      if (!settings.features.promos) {
        // Michelle can pause promo codes while a checkout page is open, and that
        // page is still showing the discount. Say so instead of quietly charging
        // the full amount.
        return {
          ok: false,
          error: "Promo codes have just been paused. Please remove the code, then place your order again.",
        };
      }
      const result = await validatePromo(promoCode, subtotalCents, {
        userId: user?.id ?? null,
        email: input.email,
        deliveryFeeCents,
      });
      if (result.ok) {
        promoDiscount = Math.min(result.discountCents, room);
        appliedPromo = result.code;
        // Carried to the insert so the caps are re-asserted under a lock there.
        promoMaxRedemptions = result.maxRedemptions;
        promoPerCustomerLimit = result.perCustomerLimit;
        room -= promoDiscount;
      } else {
        // Never silently drop a discount the customer saw on the button. The
        // code can legitimately expire or hit its cap between Apply and here.
        return {
          ok: false,
          error: `That promo code is no longer valid (${result.error}). Please remove it or try another, then place your order again.`,
        };
      }
    }

    // Rewards points for signed-in customers only, filling whatever discount room remains.
    let pointsRedeemed = 0;
    let pointsDiscount = 0;
    if (redeemPoints && user) {
      if (!settings.features.rewards) {
        // Same as the promo case: the total on their screen includes the points
        // discount, so refuse rather than charge more than the page promised.
        return {
          ok: false,
          error: "Rewards points have just been paused. Please untick “Use my points”, then place your order again.",
        };
      }
      const { data: ledger } = await supabase
        .from("points_ledger")
        .select("delta")
        .eq("user_id", user.id);
      const balance = ((ledger as { delta: number }[] | null) ?? []).reduce(
        (sum, e) => sum + e.delta,
        0,
      );
      // Points redeemed on this customer's placed-but-unpaid orders are not
      // debited from the ledger until the order is marked paid, so subtract
      // them from the balance here. Otherwise the same points could be redeemed
      // again on a second, concurrent order and drive the ledger negative.
      // A failed payment is just as unpaid as a pending one, and the order can
      // still be marked paid later, so failed orders hold their points too.
      const admin = createAdminClient();
      const { data: heldRows } = await admin
        .from("orders")
        .select("points_redeemed")
        .eq("user_id", user.id)
        .in("payment_status", ["pending", "failed"])
        .neq("status", "cancelled");
      const heldPoints = ((heldRows as { points_redeemed: number }[] | null) ?? []).reduce(
        (sum, o) => sum + (o.points_redeemed ?? 0),
        0,
      );
      const available = Math.max(0, balance - heldPoints);
      const { data: settingsRow } = await supabase
        .from("settings")
        .select("point_value_cents")
        .eq("id", 1)
        .single();
      const pointValue =
        (settingsRow as { point_value_cents: number } | null)?.point_value_cents ?? 5;
      // A point value of 0 (owner set it blank) would make the discount NaN.
      pointsDiscount =
        pointValue > 0 ? Math.floor(Math.min(available * pointValue, room) / pointValue) * pointValue : 0;
      pointsRedeemed = pointValue > 0 ? pointsDiscount / pointValue : 0;
      room -= pointsDiscount;
    }

    // Structured order notes, validate required prompts and keep only known answers.
    const noteAnswers: { id: string; label: string; answer: string }[] = [];
    if (settings.features.structuredNotes && settings.notePrompts.length > 0) {
      const provided = new Map((input.noteAnswers ?? []).map((a) => [a.id, a.answer]));
      for (const prompt of settings.notePrompts) {
        const answer = (provided.get(prompt.id) ?? "").trim();
        if (prompt.required && !answer) {
          return { ok: false, error: `Please answer: ${prompt.label}` };
        }
        // Bounded like the rest of the free text, since these ride the same
        // public endpoint and land on the same two surfaces.
        if (answer.length > MAX_NOTE_ANSWER_LENGTH) {
          return { ok: false, error: `That answer is too long: ${prompt.label}` };
        }
        if (answer) noteAnswers.push({ id: prompt.id, label: prompt.label, answer });
      }
    }

    // The counts above give fast, friendly refusals, but they can race with a
    // concurrent checkout. The insert RPC re-checks both caps under a lock and
    // raises a marker we translate back into the same copy here.
    let created;
    try {
      created = await createOrder(
        {
          ...input,
          items,
          phone: normalizedPhone,
          recipientPhone: normalizedRecipientPhone ?? undefined,
          noteAnswers,
          isGift: settings.features.gifting ? input.isGift ?? false : false,
          // Only a self-scheduled gift gets a recipient link, so mint one from
          // the checked flag rather than from what the request asked for.
          recipientScheduling: giftSelfSchedule,
          timeWindow,
          deliveryFeeCents,
        },
        user?.id ?? null,
        { pointsRedeemed, discountCents: promoDiscount + pointsDiscount },
        appliedPromo,
        {
          dailyCap: settings.dailyOrderCap && settings.dailyOrderCap > 0 ? settings.dailyOrderCap : null,
          windowCap:
            settings.perWindowCap && settings.perWindowCap > 0 && !giftSelfSchedule
              ? settings.perWindowCap
              : null,
          promoMaxRedemptions,
          promoPerCustomerLimit,
        },
      );
    } catch (orderError) {
      // The checks above give fast, friendly refusals, but each of them counts
      // rows and can be raced by a second checkout before this one inserts. The
      // insert re-asserts all of them under a lock and raises these markers, so
      // a request that loses the race gets the same words rather than a crash.
      const message = orderError instanceof Error ? orderError.message : "";
      if (message === "capacity_day_full") {
        return { ok: false, error: "That date is fully booked. Please pick another." };
      }
      if (message === "capacity_window_full") {
        return { ok: false, error: "That time slot is fully booked. Please pick another window." };
      }
      if (message === "promo_cap_reached" || message === "promo_customer_cap") {
        return {
          ok: false,
          error:
            "That promo code has just been used up. Please remove it, then place your order again.",
        };
      }
      if (message === "points_unavailable") {
        return {
          ok: false,
          error:
            "Your points have just been used on another order. Please refresh and place this one again.",
        };
      }
      throw orderError;
    }

    // The order and its confirmation emails already exist, so a failure creating
    // the Stripe session must not bubble to the generic catch that prompts a
    // retry and duplicates the whole order. Fall back to the PayNow/WhatsApp
    // tracking flow instead.
    let checkoutUrl: string | null | undefined = null;
    try {
      checkoutUrl = await createCheckoutSession({
        orderNumber: created.orderNumber,
        trackingToken: created.trackingToken,
        items,
        deliveryFeeCents: created.deliveryFeeCents,
        discountCents: created.discountCents,
      });
    } catch (sessionError) {
      Sentry.captureException(sessionError);
    }

    // Close any abandoned-cart intent for this email so no reminder is sent.
    if (settings.features.abandonedCart) await markConverted(input.email);

    return { ok: true, redirectUrl: checkoutUrl ?? `/track/${created.trackingToken}` };
  } catch (error) {
    // Validation problems are returned above, so anything thrown this far is an
    // unexpected server or database fault. Log the detail for us, show the
    // customer a plain line, never a raw Postgres or Stripe message.
    Sentry.captureException(error);
    return {
      ok: false,
      error: "Something went wrong placing your order. Please try again, or send us a message on WhatsApp.",
    };
  }
}
