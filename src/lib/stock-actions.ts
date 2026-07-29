"use server";

import { createServerSupabase } from "@/lib/supabase/server";
import { fetchStoreSettings } from "@/lib/settings";
import { rateLimit } from "@/lib/rate-limit";
import { subscribeBackInStock } from "@/lib/stock-notify";
import { EMAIL_RE } from "@/lib/text";

export type NotifyResult =
  | { ok: true; confirmed: boolean; alreadySent?: true }
  | { ok: false; error: string };

/**
 * Subscribe to a product's back-in-stock alert. Guests pass their email in, and
 * signed-in users have it resolved from the session, ignoring any client value.
 * Rate-limited and gated by the back-in-stock feature. Guests go through the
 * double-opt-in confirmation email; a signed-in user's account address is
 * already theirs, so it confirms on the spot.
 */
export async function subscribeBackInStockAction(
  productId: string,
  email: string,
): Promise<NotifyResult> {
  if (!(await rateLimit("back-in-stock", { limit: 10, windowMs: 5 * 60_000 }))) {
    return { ok: false, error: "Too many requests. Please wait a few minutes." };
  }
  const features = (await fetchStoreSettings()).features;
  if (!features.backInStock && !features.drops) {
    return { ok: false, error: "Notifications aren’t available right now." };
  }
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Signed-in users always use their account email. Guests use the form value.
  const resolved = user?.email ?? email.trim().toLowerCase();
  if (!EMAIL_RE.test(resolved)) {
    return { ok: false, error: "Please enter a valid email." };
  }
  const preConfirmed = Boolean(user?.email);
  // Throttles so repeat subscribes can't bombard a guest-entered inbox with
  // confirmation emails. Both are keyed on the address alone, no client IP, or
  // someone rotating their source address would get a fresh budget each time.
  // Every product sends its own confirmation email, so the tight bucket counts
  // per product. The looser one caps what a single inbox can get in total.
  if (!preConfirmed) {
    const throttled =
      !(await rateLimit(`back-in-stock:${resolved}:${productId}`, {
        limit: 3,
        windowMs: 60 * 60_000,
        scope: "global",
      })) ||
      !(await rateLimit(`back-in-stock:${resolved}`, {
        limit: 10,
        windowMs: 60 * 60_000,
        scope: "global",
      }));
    // Say so rather than implying a fresh email just went out, since nothing is
    // saved here and the visitor would otherwise wait for mail that never comes.
    if (throttled) return { ok: true, confirmed: false, alreadySent: true };
  }
  await subscribeBackInStock(productId, resolved, user?.id ?? null, preConfirmed);
  return { ok: true, confirmed: preConfirmed };
}
