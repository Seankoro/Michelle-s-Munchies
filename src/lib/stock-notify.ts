import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendBackInStockEmail } from "@/lib/email";

/**
 * Records a back-in-stock subscription. The partial unique index on product_id
 * and lower(email) where notified_at is null dedupes, so a repeat subscribe is
 * a harmless no-op.
 */
export async function subscribeBackInStock(
  productId: string,
  email: string,
  userId: string | null = null,
): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("stock_notifications")
    .insert({ product_id: productId, email: email.trim().toLowerCase(), user_id: userId });
  // 23505 means already subscribed via the unique index. Fine to ignore.
  if (error && error.code !== "23505") {
    console.error("[stock-notify] subscribe failed:", error.message);
  }
}

/**
 * Emails everyone waiting on a product on a best-effort basis and stamps them
 * notified so they aren't emailed again. Called when a product becomes available.
 */
export async function notifySubscribers(productId: string): Promise<void> {
  const supabase = createAdminClient();
  const { data: subs } = await supabase
    .from("stock_notifications")
    .select("id, email")
    .eq("product_id", productId)
    .is("notified_at", null);
  const rows = (subs as { id: string; email: string }[] | null) ?? [];
  if (rows.length === 0) return;

  const { data: product } = await supabase
    .from("products")
    .select("name, slug")
    .eq("id", productId)
    .maybeSingle();
  const p = product as { name: string; slug: string } | null;
  if (!p) return;

  for (const sub of rows) {
    await sendBackInStockEmail(sub.email, p.name, p.slug);
  }
  await supabase
    .from("stock_notifications")
    .update({ notified_at: new Date().toISOString() })
    .in(
      "id",
      rows.map((r) => r.id),
    );
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
