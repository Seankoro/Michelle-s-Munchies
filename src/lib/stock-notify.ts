import "server-only";
import { newToken } from "@/lib/tokens";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendBackInStockEmail, sendSubscriptionConfirmEmail } from "@/lib/email";

/**
 * Records a back-in-stock subscription and sends the double-opt-in
 * confirmation. The alert only ever fires for confirmed addresses, so nobody
 * can sign somebody else's inbox up for our mail. The partial unique index on
 * product_id and lower(email) where notified_at is null dedupes; a repeat
 * subscribe just re-sends the confirmation while unconfirmed.
 */
export async function subscribeBackInStock(
  productId: string,
  email: string,
  userId: string | null = null,
  preConfirmed = false,
): Promise<void> {
  const supabase = createAdminClient();
  const normalized = email.trim().toLowerCase();
  let confirmToken: string | null = newToken();
  const { error } = await supabase.from("stock_notifications").insert({
    product_id: productId,
    email: normalized,
    user_id: userId,
    confirm_token: confirmToken,
    // A signed-in customer's account address is already theirs. Only guests
    // need the confirmation round trip.
    confirmed_at: preConfirmed ? new Date().toISOString() : null,
  });
  if (preConfirmed && !error) return;
  if (preConfirmed && error) {
    if (error.code !== "23505") console.error("[stock-notify] subscribe failed:", error.message);
    // Already subscribed as a guest earlier: promote that row to confirmed.
    if (error.code === "23505") {
      await supabase
        .from("stock_notifications")
        .update({ confirmed_at: new Date().toISOString() })
        .eq("product_id", productId)
        .eq("email", normalized)
        .is("notified_at", null)
        .is("confirmed_at", null);
    }
    return;
  }
  if (error) {
    // 23505 means already subscribed via the unique index. Re-send the
    // confirmation if that subscription is still unconfirmed, else stay quiet.
    if (error.code !== "23505") {
      console.error("[stock-notify] subscribe failed:", error.message);
      return;
    }
    const { data } = await supabase
      .from("stock_notifications")
      .select("confirm_token, confirmed_at")
      .eq("product_id", productId)
      .eq("email", normalized)
      .is("notified_at", null)
      .maybeSingle();
    const existing = data as { confirm_token: string | null; confirmed_at: string | null } | null;
    if (!existing || existing.confirmed_at) return;
    confirmToken = existing.confirm_token;
    if (!confirmToken) {
      confirmToken = newToken();
      await supabase
        .from("stock_notifications")
        .update({ confirm_token: confirmToken })
        .eq("product_id", productId)
        .eq("email", normalized)
        .is("notified_at", null);
    }
  }

  const { data: product } = await supabase
    .from("products")
    .select("name")
    .eq("id", productId)
    .maybeSingle();
  const productName = (product as { name: string } | null)?.name ?? "this treat";
  await sendSubscriptionConfirmEmail(normalized, { list: "stock", productName }, confirmToken);
}

/**
 * Emails everyone waiting on a product on a best-effort basis and stamps them
 * notified so they aren't emailed again. Called when a product becomes
 * available. Only confirmed subscribers are ever emailed, and only while the
 * product is actually buyable.
 */
export async function notifySubscribers(productId: string): Promise<void> {
  const supabase = createAdminClient();
  const { data: subs } = await supabase
    .from("stock_notifications")
    .select("id, email")
    .eq("product_id", productId)
    .is("notified_at", null)
    .not("confirmed_at", "is", null);
  const rows = (subs as { id: string; email: string }[] | null) ?? [];
  if (rows.length === 0) return;

  const { data: product } = await supabase
    .from("products")
    .select("name, slug, is_available, stock_count")
    .eq("id", productId)
    .maybeSingle();
  const p = product as {
    name: string;
    slug: string;
    is_available: boolean;
    stock_count: number | null;
  } | null;
  if (!p) return;
  // Never say "it's back" about something nobody can buy. The drops job below
  // re-scans every product that ever had a launch time, so without this it
  // would fire on a drop that launched and then sold out, and stamp that
  // product's sold-out waitlist notified, swallowing the real restock alert.
  if (!p.is_available || (p.stock_count != null && p.stock_count <= 0)) return;

  // Stamp each subscriber only after their own email really went out. Stamping
  // the whole batch afterwards meant one provider rejection silently marked
  // someone notified who never heard anything, and the alert they were waiting
  // for could never be sent again.
  for (const sub of rows) {
    const delivered = await sendBackInStockEmail(sub.email, p.name, p.slug);
    if (!delivered) continue;
    await supabase
      .from("stock_notifications")
      .update({ notified_at: new Date().toISOString() })
      .eq("id", sub.id);
  }
}

/**
 * Notify waitlists for any seasonal drop whose go-live time has passed. Safe to
 * run repeatedly, since notifySubscribers only emails un-notified subscribers.
 */
export async function notifyLaunchedDrops(): Promise<number> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("products")
    .select("id")
    .not("available_from", "is", null)
    .lte("available_from", new Date().toISOString());
  const ids = (data as { id: string }[] | null) ?? [];
  for (const p of ids) await notifySubscribers(p.id);
  return ids.length;
}

/**
 * Confirm a back-in-stock subscription by its token. Returns the product name
 * when the token matched, null otherwise. Idempotent: confirming twice is fine.
 */
export async function confirmStockSubscription(token: string): Promise<string | null> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("stock_notifications")
    .update({ confirmed_at: new Date().toISOString() })
    .eq("confirm_token", token)
    .select("product_id")
    .maybeSingle();
  const row = data as { product_id: string } | null;
  if (!row) return null;
  const { data: product } = await supabase
    .from("products")
    .select("name")
    .eq("id", row.product_id)
    .maybeSingle();
  return (product as { name: string } | null)?.name ?? "this treat";
}
