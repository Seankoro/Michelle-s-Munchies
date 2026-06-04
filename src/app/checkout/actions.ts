"use server";

import { createOrder, type CreateOrderInput } from "@/lib/orders-db";
import { createCheckoutSession } from "@/lib/payments";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { computeDeliveryFeeCents, earliestFulfillmentDate } from "@/lib/order";
import { singaporeNow } from "@/lib/time";
import { fetchStoreSettings, type FeatureFlags } from "@/lib/settings";
import { formatPrice } from "@/lib/catalog";
import { rateLimit } from "@/lib/rate-limit";
import { validatePromo, type PromoValidation } from "@/lib/promos";
import { validateBundleForCheckout } from "@/lib/bundles";
import { validateBoxForCheckout, validateFlavourBoxForCheckout } from "@/lib/boxes";
import { recordIntent, markConverted } from "@/lib/checkout-intents";
import { EMAIL_RE } from "@/lib/text";
import { normalizeSgPhone } from "@/lib/phone";

export type PlaceOrderResult =
  | { ok: true; redirectUrl: string }
  | { ok: false; error: string };

function subtotalOf(items: CreateOrderInput["items"]): number {
  return items.reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0);
}

/**
 * Re-validate and authoritatively re-price "special" cart lines server-side —
 * bundles (and build-a-box lines, added later). The client-sent price/contents
 * are never trusted; the DB price wins, and unavailable items are rejected.
 */
async function sanitizeSpecialLines(
  items: CreateOrderInput["items"],
  features: FeatureFlags,
): Promise<{ ok: true; items: CreateOrderInput["items"] } | { ok: false; error: string }> {
  const out: CreateOrderInput["items"] = [];
  for (const item of items) {
    if (item.productId.startsWith("bundle:")) {
      if (!features.bundles) return { ok: false, error: "Bundles aren’t available right now." };
      const slug = item.productId.slice("bundle:".length);
      const v = await validateBundleForCheckout(slug);
      if (!v) return { ok: false, error: `“${item.name}” is no longer available.` };
      if (!v.available) {
        return { ok: false, error: `“${item.name}” has a sold-out item. Please remove it.` };
      }
      out.push({ ...item, unitPriceCents: v.priceCents });
    } else if (item.productId.startsWith("box:")) {
      if (!features.buildABox) {
        return { ok: false, error: "Build-a-box isn’t available right now." };
      }
      const slug = item.productId.slice("box:".length);
      // Cart key encodes the picks: box::<slug>::<id|id|...>
      const flatIds = (item.key.split("::")[2] ?? "").split("|").filter(Boolean);
      const v = await validateBoxForCheckout(slug, flatIds);
      if (!v) return { ok: false, error: `“${item.name}” is no longer available.` };
      if ("error" in v) return { ok: false, error: v.error };
      out.push({ ...item, unitPriceCents: v.priceCents });
    } else if (item.productId.startsWith("fbox:")) {
      if (!features.buildABox) {
        return { ok: false, error: "Build-a-box isn’t available right now." };
      }
      const productId = item.productId.slice("fbox:".length);
      // Cart key encodes the picks: fbox::<productId>::<count>::<label|label|...>
      const parts = item.key.split("::");
      const count = parseInt(parts[2] ?? "", 10);
      const labels = (parts[3] ?? "").split("|").filter(Boolean);
      const v = await validateFlavourBoxForCheckout(productId, count, labels);
      if (!v) return { ok: false, error: `“${item.name}” is no longer available.` };
      if ("error" in v) return { ok: false, error: v.error };
      out.push({ ...item, unitPriceCents: v.priceCents });
    } else {
      out.push(item);
    }
  }
  return { ok: true, items: out };
}

/**
 * Capture a checkout intent (cart + email) for the abandoned-cart reminder.
 * Rate-limited + feature-gated; failures are swallowed (never block checkout).
 */
export async function recordCheckoutIntentAction(
  email: string,
  items: { name: string; quantity: number }[],
  subtotalCents: number,
): Promise<void> {
  if (!EMAIL_RE.test(email.trim())) return;
  if (!(await rateLimit("checkout-intent", { limit: 20, windowMs: 5 * 60_000 }))) return;
  if (!(await fetchStoreSettings()).features.abandonedCart) return;
  await recordIntent(email, items, subtotalCents);
}

/** Look up the spend-gift product (only returned if it still exists + is available). */
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

/** Checkout "Apply code" — validates a promo against the current subtotal + context. */
export async function applyPromo(
  code: string,
  subtotalCents: number,
  deliveryFeeCents = 0,
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
  return validatePromo(code, subtotalCents, { userId: user?.id ?? null, deliveryFeeCents });
}

/**
 * Creates the order server-side. Discounts (promo code + rewards points) are
 * recomputed authoritatively here — never trusted from the client — combined
 * into one amount, and applied via a single Stripe coupon.
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
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    // Authoritative scheduling/fee rules come from Michelle's live settings —
    // the client's copy is only for display and is never trusted here.
    const settings = await fetchStoreSettings();

    // Validate contact details server-side too (the client checks these, but a
    // request can be POSTed directly). Phone is normalized to "+65 XXXX XXXX".
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

    // Re-validate + re-price special lines (bundles/boxes) on the server.
    const sanitized = await sanitizeSpecialLines(input.items, settings.features);
    if (!sanitized.ok) return { ok: false, error: sanitized.error };
    let items = sanitized.items;

    // Block items that haven't launched yet (seasonal drops) — server-enforced.
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

    // Spend-gift: append a free gift line once the cart clears the threshold.
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

    const deliveryFeeCents = computeDeliveryFeeCents(
      subtotalCents,
      input.fulfillmentType,
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
    // Daily order cap (null/0 = unlimited). Counted with the service-role client
    // since orders aren't publicly readable.
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
    // Per-time-window cap (null/0 = unlimited).
    if (settings.perWindowCap && settings.perWindowCap > 0 && input.timeWindow) {
      const admin = createAdminClient();
      const { count } = await admin
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("scheduled_date", input.scheduledDate)
        .eq("time_window", input.timeWindow)
        .neq("status", "cancelled");
      if ((count ?? 0) >= settings.perWindowCap) {
        return { ok: false, error: "That time slot is fully booked. Please pick another window." };
      }
    }

    // Always keep at least S$0.50 chargeable.
    let room = Math.max(0, subtotalCents + deliveryFeeCents - 50);

    // Promo code (validated server-side; available to guests too). Skipped if
    // the promo feature is turned off.
    let promoDiscount = 0;
    let appliedPromo: string | null = null;
    if (promoCode.trim() && settings.features.promos) {
      const result = await validatePromo(promoCode, subtotalCents, {
        userId: user?.id ?? null,
        deliveryFeeCents,
      });
      if (result.ok) {
        promoDiscount = Math.min(result.discountCents, room);
        appliedPromo = result.code;
        room -= promoDiscount;
      }
    }

    // Rewards points (signed-in only), filling whatever discount room remains.
    let pointsRedeemed = 0;
    let pointsDiscount = 0;
    if (redeemPoints && user && settings.features.rewards) {
      const { data: ledger } = await supabase
        .from("points_ledger")
        .select("delta")
        .eq("user_id", user.id);
      const balance = ((ledger as { delta: number }[] | null) ?? []).reduce(
        (sum, e) => sum + e.delta,
        0,
      );
      const { data: settingsRow } = await supabase
        .from("settings")
        .select("point_value_cents")
        .eq("id", 1)
        .single();
      const pointValue =
        (settingsRow as { point_value_cents: number } | null)?.point_value_cents ?? 5;
      pointsDiscount = Math.floor(Math.min(balance * pointValue, room) / pointValue) * pointValue;
      pointsRedeemed = pointValue > 0 ? pointsDiscount / pointValue : 0;
      room -= pointsDiscount;
    }

    // Structured order notes: validate required prompts + keep only known answers.
    const noteAnswers: { id: string; label: string; answer: string }[] = [];
    if (settings.features.structuredNotes && settings.notePrompts.length > 0) {
      const provided = new Map((input.noteAnswers ?? []).map((a) => [a.id, a.answer]));
      for (const prompt of settings.notePrompts) {
        const answer = (provided.get(prompt.id) ?? "").trim();
        if (prompt.required && !answer) {
          return { ok: false, error: `Please answer: ${prompt.label}` };
        }
        if (answer) noteAnswers.push({ id: prompt.id, label: prompt.label, answer });
      }
    }

    const created = await createOrder(
      {
        ...input,
        items,
        phone: normalizedPhone,
        recipientPhone: normalizedRecipientPhone ?? undefined,
        noteAnswers,
        isGift: settings.features.gifting ? input.isGift ?? false : false,
      },
      user?.id ?? null,
      { pointsRedeemed, discountCents: promoDiscount + pointsDiscount },
      appliedPromo,
    );

    const checkoutUrl = await createCheckoutSession({
      orderNumber: created.orderNumber,
      trackingToken: created.trackingToken,
      items,
      deliveryFeeCents: created.deliveryFeeCents,
      discountCents: created.discountCents,
    });

    // Close any abandoned-cart intent for this email so no reminder is sent.
    if (settings.features.abandonedCart) await markConverted(input.email);

    return { ok: true, redirectUrl: checkoutUrl ?? `/track/${created.trackingToken}` };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Something went wrong placing your order.",
    };
  }
}
