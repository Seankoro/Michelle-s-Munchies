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
 * Server-side checkout validation for a build-a-box line. `chosenPicks` is the
 * flat list of picks with repeats, each either `productId` or, for a treat
 * picked by flavour, `productId~flavour`. Confirms the count matches the
 * template, every product is eligible and available, and every chosen flavour
 * is a current, available value of that product's flavour option. Returns the
 * authoritative flat price.
 */
export async function validateBoxForCheckout(
  slug: string,
  chosenPicks: string[],
): Promise<{ priceCents: number } | { error: string } | null> {
  const box = await fetchBoxBySlug(slug);
  if (!box) return null;
  if (chosenPicks.length !== box.itemCount) {
    return { error: `${box.name} needs exactly ${box.itemCount} items.` };
  }
  const eligible = new Map(box.eligibleProducts.map((product) => [product.id, product]));
  for (const pick of chosenPicks) {
    const separator = pick.indexOf("~");
    const productId = separator === -1 ? pick : pick.slice(0, separator);
    const flavour = separator === -1 ? null : pick.slice(separator + 1);
    const product = eligible.get(productId);
    if (!product) {
      return { error: `Some items in “${box.name}” are no longer available.` };
    }
    if (flavour) {
      const option = product.options.find((o) => o.name.toLowerCase() === "flavour");
      const ok = (option?.values ?? []).some(
        (value) => value.label === flavour && value.isAvailable !== false,
      );
      if (!ok) {
        return {
          error: `Some flavours in “${box.name}” are no longer available. Please update your box.`,
        };
      }
    }
  }
  return { priceCents: box.priceCents };
}
