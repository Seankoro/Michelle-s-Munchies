import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPrice } from "@/lib/catalog";
import { singaporeDateString } from "@/lib/time";

export type PromoDiscountType = "percent" | "amount" | "free_delivery";

type PromoRow = {
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

export type PromoValidation =
  | { ok: true; code: string; discountCents: number; label: string }
  | { ok: false; error: string };

export type PromoContext = {
  /** Signed-in customer, null for guests, needed for per-customer and first-order rules. */
  userId?: string | null;
  /** The buyer's email, the only identity a guest order carries, so the
   *  per-customer cap still means something without a sign-in. */
  email?: string | null;
  /** Current delivery fee, used by the `free_delivery` discount type. */
  deliveryFeeCents?: number;
};

/**
 * Validates a promo code against the order subtotal and context and returns its
 * discount. Usage limits are counted against recorded, non-cancelled orders.
 */
export async function validatePromo(
  rawCode: string,
  subtotalCents: number,
  context: PromoContext = {},
): Promise<PromoValidation> {
  const code = rawCode.trim().toUpperCase();
  if (!code) return { ok: false, error: "Enter a code." };
  const { userId = null, email = null, deliveryFeeCents = 0 } = context;
  const normalizedEmail = (email ?? "").trim();

  const admin = createAdminClient();
  const { data } = await admin.from("promo_codes").select("*").eq("code", code).maybeSingle();
  const promo = data as PromoRow | null;

  if (!promo || !promo.active) return { ok: false, error: "That code isn’t valid." };
  // Expiry is a date-only column, so compare it against today in Singapore. The
  // server runs in UTC, where the first eight hours of a Singapore day still
  // read as yesterday and an expired code would keep working.
  if (promo.expires_at && promo.expires_at < singaporeDateString()) {
    return { ok: false, error: "That code has expired." };
  }
  if (subtotalCents < promo.min_order_cents) {
    return {
      ok: false,
      error: `This code needs a minimum order of ${formatPrice(promo.min_order_cents)}.`,
    };
  }

  // First-order-only, requires a signed-in customer with no prior orders.
  if (promo.first_order_only) {
    if (!userId) return { ok: false, error: "Sign in to use this code." };
    const { count } = await admin
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .neq("status", "cancelled");
    if ((count ?? 0) > 0) {
      return { ok: false, error: "This code is for first orders only." };
    }
  }

  // Total redemption cap across all customers.
  if (promo.max_redemptions != null) {
    const { count } = await admin
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("promo_code", code)
      .neq("status", "cancelled");
    if ((count ?? 0) >= promo.max_redemptions) {
      return { ok: false, error: "This code has reached its limit." };
    }
  }

  // Per-customer cap. A signed-in customer is counted by account. Most orders
  // here are placed without signing in, so a guest is counted by the email on
  // their past orders instead, matched case-insensitively because an order keeps
  // the address exactly as it was typed. With neither identity, at "Apply code"
  // before the email is filled in, the cap is left to the placeOrder re-check.
  if (promo.per_customer_limit != null && (userId || normalizedEmail)) {
    const query = admin
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("promo_code", code)
      .neq("status", "cancelled");
    // `_` and `%` are wildcards to ilike and `_` is common in an address, so
    // escape them and the match stays an exact one, case aside.
    const emailPattern = normalizedEmail.replace(/[\\%_]/g, (char) => `\\${char}`);
    const { count } = await (userId
      ? query.eq("user_id", userId)
      : query.ilike("email", emailPattern));
    if ((count ?? 0) >= promo.per_customer_limit) {
      return { ok: false, error: "You’ve already used this code." };
    }
  }

  let discountCents: number;
  let label: string;
  if (promo.discount_type === "percent") {
    discountCents = Math.round((subtotalCents * promo.discount_value) / 100);
    label = `${promo.discount_value}% off`;
  } else if (promo.discount_type === "amount") {
    discountCents = Math.min(promo.discount_value, subtotalCents);
    label = `${formatPrice(promo.discount_value)} off`;
  } else {
    // free_delivery, discount equals the current delivery fee, 0 for pickup.
    discountCents = Math.max(0, deliveryFeeCents);
    label = "Free delivery";
  }

  return { ok: true, code, discountCents, label };
}
