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
  // Bounded on purpose. The default client waits 80 seconds, which is longer
  // than the serverless function itself lives, so a slow Stripe turns into a
  // killed request rather than an error anyone can handle. Ten seconds fails
  // fast enough that the caller's own catch can fall back, and one retry covers
  // an ordinary blip without doubling a charge, since Stripe treats a repeated
  // request on the same idempotency key as the same request.
  if (!cached) cached = new Stripe(key, { timeout: 10_000, maxNetworkRetries: 1 });
  return cached;
}
