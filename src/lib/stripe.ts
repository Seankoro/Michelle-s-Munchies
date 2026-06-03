import "server-only";
import Stripe from "stripe";

let cached: Stripe | null = null;

/**
 * Server-only Stripe client. Returns null when STRIPE_SECRET_KEY isn't set, so
 * the rest of the app can gracefully fall back to the no-payment flow.
 */
export function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  if (!cached) cached = new Stripe(key);
  return cached;
}
