"use server";

import { createServerSupabase } from "@/lib/supabase/server";
import { fetchStoreSettings } from "@/lib/settings";
import { rateLimit } from "@/lib/rate-limit";
import { subscribeBackInStock } from "@/lib/stock-notify";
import { EMAIL_RE } from "@/lib/text";

export type NotifyResult = { ok: true } | { ok: false; error: string };

/**
 * Subscribe to a product's back-in-stock alert. Guests pass their email in, and
 * signed-in users have it resolved from the session, ignoring any client value.
 * Rate-limited and gated by the back-in-stock feature.
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
  await subscribeBackInStock(productId, resolved, user?.id ?? null);
  return { ok: true };
}
