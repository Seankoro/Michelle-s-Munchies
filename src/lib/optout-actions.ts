"use server";

import { rateLimit } from "@/lib/rate-limit";
import { optOutByToken } from "@/lib/email-optout";

export type OptOutResult = { ok: true } | { ok: false; error: string };

/**
 * Record a marketing opt-out from the footer link in a reminder or offer email.
 * Public and unauthenticated, like the newsletter unsubscribe beside it, since
 * someone withdrawing consent must not be asked to sign in first.
 */
export async function optOutOfMarketingAction(token: string): Promise<OptOutResult> {
  if (!(await rateLimit("marketing-opt-out", { limit: 20, windowMs: 5 * 60_000 }))) {
    return { ok: false, error: "Too many requests. Please wait a few minutes." };
  }
  const ok = await optOutByToken(token.trim());
  return ok ? { ok: true } : { ok: false, error: "This link is no longer valid." };
}
