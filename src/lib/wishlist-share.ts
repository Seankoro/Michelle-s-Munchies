import "server-only";
import { randomBytes } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchProducts } from "@/lib/products";

export type SharedFavourite = {
  id: string;
  name: string;
  slug: string;
  priceCents: number;
  imageUrl: string | null;
  hasOptions: boolean;
};

/** Mint or return the existing unguessable share token for a user's wishlist. */
export async function getOrCreateShareToken(userId: string): Promise<string> {
  const supabase = createAdminClient();
  const { data: existing } = await supabase
    .from("wishlist_shares")
    .select("token")
    .eq("user_id", userId)
    .maybeSingle();
  const row = existing as { token: string } | null;
  if (row) return row.token;

  const token = randomBytes(16).toString("hex");
  const { error } = await supabase.from("wishlist_shares").insert({ token, user_id: userId });
  if (error) throw new Error(`Could not create share link: ${error.message}`);
  return token;
}

/**
 * Resolve a share token to the owner's current favourites, names, prices, and
 * links only. Never returns the owner's identity or any PII.
 */
export async function fetchSharedFavourites(token: string): Promise<SharedFavourite[] | null> {
  const supabase = createAdminClient();
  const { data: share } = await supabase
    .from("wishlist_shares")
    .select("user_id")
    .eq("token", token)
    .maybeSingle();
  const owner = share as { user_id: string } | null;
  if (!owner) return null;

  const { data: rows } = await supabase
    .from("wishlists")
    .select("product_id")
    .eq("user_id", owner.user_id);
  const ids = new Set(((rows as { product_id: string }[] | null) ?? []).map((r) => r.product_id));
  if (ids.size === 0) return [];

  const products = await fetchProducts();
  return products
    .filter((p) => ids.has(p.id))
    .map((p) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      priceCents: p.basePriceCents,
      imageUrl: p.imageUrls && p.imageUrls.length > 0 ? p.imageUrls[0] : null,
      hasOptions: p.options.length > 0,
    }));
}
