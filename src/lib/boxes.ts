import "server-only";
import { createPublicClient } from "@/lib/supabase/public";
import { fetchProducts } from "@/lib/products";
import type { BoxTemplate, Product } from "@/lib/types";

type BoxRow = {
  id: string;
  name: string;
  slug: string;
  item_count: number;
  price_cents: number;
  eligible_category: string | null;
  is_active: boolean;
  sort_order: number;
  box_template_items: { product_id: string }[] | null;
};

const BOX_SELECT =
  "id, name, slug, item_count, price_cents, eligible_category, is_active, sort_order, box_template_items(product_id)";

/** Resolve the eligible product pool for a box: explicit allowlist, else category. */
function resolveEligible(row: BoxRow, allProducts: Product[]): Product[] {
  const explicitIds = (row.box_template_items ?? []).map((i) => i.product_id);
  if (explicitIds.length > 0) {
    const set = new Set(explicitIds);
    return allProducts.filter((p) => set.has(p.id) && p.isAvailable);
  }
  if (row.eligible_category) {
    return allProducts.filter((p) => p.category === row.eligible_category && p.isAvailable);
  }
  return allProducts.filter((p) => p.isAvailable);
}

function rowToBox(row: BoxRow, allProducts: Product[]): BoxTemplate {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    itemCount: row.item_count,
    priceCents: row.price_cents,
    eligibleProducts: resolveEligible(row, allProducts),
  };
}

export async function fetchActiveBoxTemplates(): Promise<BoxTemplate[]> {
  const supabase = createPublicClient();
  const { data, error } = await supabase
    .from("box_templates")
    .select(BOX_SELECT)
    .eq("is_active", true)
    .order("sort_order", { ascending: true });
  if (error) throw new Error(`Failed to load box templates: ${error.message}`);
  const rows = (data as unknown as BoxRow[] | null) ?? [];
  if (rows.length === 0) return [];
  const products = await fetchProducts();
  return rows.map((row) => rowToBox(row, products));
}

export async function fetchBoxBySlug(slug: string): Promise<BoxTemplate | null> {
  const supabase = createPublicClient();
  const { data, error } = await supabase
    .from("box_templates")
    .select(BOX_SELECT)
    .eq("slug", slug)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw new Error(`Failed to load box: ${error.message}`);
  if (!data) return null;
  const products = await fetchProducts();
  return rowToBox(data as unknown as BoxRow, products);
}

/**
 * Server-side checkout validation for a build-a-box line. `chosenProductIds` is
 * the flat list of picks (with repeats). Confirms the count matches the template
 * and every pick is eligible + available; returns the authoritative price.
 */
export async function validateBoxForCheckout(
  slug: string,
  chosenProductIds: string[],
): Promise<{ priceCents: number } | { error: string } | null> {
  const box = await fetchBoxBySlug(slug);
  if (!box) return null;
  if (chosenProductIds.length !== box.itemCount) {
    return { error: `${box.name} needs exactly ${box.itemCount} items.` };
  }
  const eligible = new Set(box.eligibleProducts.map((p) => p.id));
  if (!chosenProductIds.every((id) => eligible.has(id))) {
    return { error: `Some items in “${box.name}” are no longer available.` };
  }
  return { priceCents: box.priceCents };
}
