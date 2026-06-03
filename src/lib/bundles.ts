import "server-only";
import { createPublicClient } from "@/lib/supabase/public";
import type { Bundle } from "@/lib/types";

type BundleItemRow = {
  quantity: number;
  product_id: string | null;
  products: { name: string } | null;
};

type BundleRow = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  price_cents: number;
  image_path: string | null;
  sort_order: number;
  bundle_items: BundleItemRow[] | null;
};

const BUNDLE_SELECT =
  "id, name, slug, description, price_cents, image_path, sort_order, bundle_items(quantity, product_id, products(name))";

function rowToBundle(row: BundleRow): Bundle {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    priceCents: row.price_cents,
    imageUrl: row.image_path,
    items: (row.bundle_items ?? []).map((item) => ({
      productId: item.product_id,
      productName: item.products?.name ?? "Treat",
      quantity: item.quantity,
    })),
  };
}

/** Active bundles for the storefront, in display order. */
export async function fetchActiveBundles(): Promise<Bundle[]> {
  const supabase = createPublicClient();
  const { data, error } = await supabase
    .from("bundles")
    .select(BUNDLE_SELECT)
    .eq("is_active", true)
    .order("sort_order", { ascending: true });
  if (error) throw new Error(`Failed to load bundles: ${error.message}`);
  return ((data as unknown as BundleRow[] | null) ?? []).map(rowToBundle);
}

export async function fetchBundleBySlug(slug: string): Promise<Bundle | null> {
  const supabase = createPublicClient();
  const { data, error } = await supabase
    .from("bundles")
    .select(BUNDLE_SELECT)
    .eq("slug", slug)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw new Error(`Failed to load bundle: ${error.message}`);
  return data ? rowToBundle(data as unknown as BundleRow) : null;
}

/**
 * Server-side validation helper for checkout: confirms a bundle is still active
 * and all its products are available, and returns its authoritative price.
 * Returns null if the bundle is gone/inactive.
 */
export async function validateBundleForCheckout(
  slug: string,
): Promise<{ priceCents: number; available: boolean } | null> {
  const supabase = createPublicClient();
  const { data, error } = await supabase
    .from("bundles")
    .select("price_cents, is_active, bundle_items(products(is_available))")
    .eq("slug", slug)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as unknown as {
    price_cents: number;
    is_active: boolean;
    bundle_items: { products: { is_available: boolean } | null }[] | null;
  };
  if (!row.is_active) return null;
  const available = (row.bundle_items ?? []).every((i) => i.products?.is_available ?? false);
  return { priceCents: row.price_cents, available };
}
