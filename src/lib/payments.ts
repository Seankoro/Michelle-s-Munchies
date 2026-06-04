import "server-only";
import { getStripe } from "@/lib/stripe";
import type { CartItem } from "@/lib/types";

type CheckoutSessionInput = {
  orderNumber: string;
  trackingToken: string;
  items: CartItem[];
  deliveryFeeCents: number;
  discountCents: number;
};

/**
 * Creates a Stripe Checkout Session for an order and returns its hosted URL.
 * Returns null when Stripe isn't configured, and the caller then falls back to
 * the no-payment flow. PayNow and cards are offered. Wallets like Apple Pay and
 * Google Pay appear automatically on the hosted page.
 */
export async function createCheckoutSession(
  input: CheckoutSessionInput,
): Promise<string | null> {
  const stripe = getStripe();
  if (!stripe) return null;

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

  // Zero-priced lines such as a free spend-gift are recorded on the order but
  // omitted here, since Stripe rejects line items priced at 0.
  const lineItems = input.items
    .filter((item) => item.unitPriceCents > 0)
    .map((item) => ({
      quantity: item.quantity,
      price_data: {
        currency: "sgd",
        unit_amount: item.unitPriceCents,
        product_data: {
          name: item.name,
          description:
            item.selectedOptions.length > 0
              ? item.selectedOptions.map((o) => o.valueLabel).join(", ")
              : undefined,
        },
      },
    }));

  if (input.deliveryFeeCents > 0) {
    lineItems.push({
      quantity: 1,
      price_data: {
        currency: "sgd",
        unit_amount: input.deliveryFeeCents,
        product_data: { name: "Delivery", description: undefined },
      },
    });
  }

  // Apply redeemed points as a one-time coupon discount.
  let discounts: { coupon: string }[] | undefined;
  if (input.discountCents > 0) {
    const coupon = await stripe.coupons.create({
      amount_off: input.discountCents,
      currency: "sgd",
      duration: "once",
      name: "Rewards points",
    });
    discounts = [{ coupon: coupon.id }];
  }

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["paynow", "card"],
    line_items: lineItems,
    discounts,
    success_url: `${siteUrl}/track/${input.trackingToken}`,
    cancel_url: `${siteUrl}/checkout`,
    metadata: {
      order_number: input.orderNumber,
      tracking_token: input.trackingToken,
    },
  });

  return session.url;
}

/** Refund a paid order's PaymentIntent in full. Returns false if Stripe isn't configured. */
export async function refundOrder(paymentIntentId: string): Promise<boolean> {
  const stripe = getStripe();
  if (!stripe) return false;
  try {
    await stripe.refunds.create({ payment_intent: paymentIntentId });
    return true;
  } catch (error) {
    console.error("[refund] failed:", error);
    return false;
  }
}
