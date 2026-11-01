"use server";

import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchStoreSettings } from "@/lib/settings";
import { fetchSuggestionPool } from "@/lib/products";
import type { Product } from "@/lib/types";

/** How many of a customer's most recent orders count as "bought before". */
const RECENT_ORDERS = 20;

export type CartSuggestionData = {
  /** Treats on sale now, unranked. The cart page ranks them as the cart changes. */
  pool: Product[];
  /** Products the signed-in customer has ordered before, empty for guests. */
  boughtIds: string[];
};

/**
 * What the cart's "Add a little something" row needs. Empty when Michelle has
 * the row switched off, so the page shows nothing.
 */
export async function loadCartSuggestions(): Promise<CartSuggestionData> {
  if (!(await fetchStoreSettings()).features.cartSuggestions) {
    return { pool: [], boughtIds: [] };
  }
  const [pool, boughtIds] = await Promise.all([fetchSuggestionPool(), fetchBoughtIds()]);
  return { pool, boughtIds };
}

/**
 * Products from the signed-in customer's recent orders. Read with the service
 * role, since orders are not user-readable, and scoped to their own user id.
 */
async function fetchBoughtIds(): Promise<string[]> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const admin = createAdminClient();
  const { data: orders } = await admin
    .from("orders")
    .select("id")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(RECENT_ORDERS);
  const orderIds = ((orders as { id: string }[] | null) ?? []).map((o) => o.id);
  if (orderIds.length === 0) return [];

  const { data: lines } = await admin
    .from("order_items")
    .select("product_id")
    .in("order_id", orderIds);
  // Bundle and box lines have no product id, so they never count.
  const ids = ((lines as { product_id: string | null }[] | null) ?? [])
    .map((line) => line.product_id)
    .filter((id): id is string => Boolean(id));
  return [...new Set(ids)];
}
