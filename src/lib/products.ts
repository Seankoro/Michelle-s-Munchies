import "server-only";
import type { Allergen, DietaryTag, FlavourBoxConfig, IngredientLine, Product } from "@/lib/types";
import { createPublicClient } from "@/lib/supabase/public";

/**
 * Read the ingredients jsonb. Handles both the new { name, amount, unit } objects
 * and any legacy plain-string entries, so a half-migrated row never breaks a page.
 */
function parseIngredients(raw: unknown): IngredientLine[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry): IngredientLine | null => {
      if (typeof entry === "string") return entry.trim() ? { name: entry.trim() } : null;
      if (entry && typeof entry === "object" && "name" in entry) {
        const e = entry as { name: unknown; amount?: unknown; unit?: unknown };
        const name = String(e.name ?? "").trim();
        if (!name) return null;
        return {
          name,
          amount: typeof e.amount === "number" && e.amount > 0 ? e.amount : null,
          unit: typeof e.unit === "string" && e.unit.trim() ? e.unit.trim() : null,
        };
      }
      return null;
    })
    .filter((x): x is IngredientLine => x !== null);
}

// Shape of the rows returned by the nested products query below.
type OptionValueRow = {
  id: string;
  label: string;
  price_delta_cents: number;
  is_available: boolean;
  sort_order: number;
};
type OptionRow = {
  id: string;
  name: string;
  required: boolean;
  sort_order: number;
  product_option_values: OptionValueRow[] | null;
};
type ProductRow = {
  id: string;
  slug: string;
  name: string;
  short_description: string | null;
  long_description: string | null;
  base_price_cents: number;
  cost_cents: number | null;
  category: string;
  image_paths: string[] | null;
  is_available: boolean;
  is_best_seller: boolean;
  is_recommended: boolean;
  allergens: Allergen[] | null;
  dietary_tags: DietaryTag[] | null;
  ingredients: unknown;
  storage_info: string | null;
  serving_info: string | null;
  stock_count: number | null;
  available_from: string | null;
  product_options: OptionRow[] | null;
  flavour_box: FlavourBoxConfig | null;
  personalisation_label: string | null;
  personalisation_allow_photo: boolean | null;
};

const PRODUCT_SELECT = "*, product_options(*, product_option_values(*))";

function bySortOrder<T extends { sort_order: number }>(a: T, b: T) {
  return a.sort_order - b.sort_order;
}

function rowToProduct(row: ProductRow): Product {
  const options = (row.product_options ?? []).sort(bySortOrder).map((option) => ({
    id: option.id,
    name: option.name,
    required: option.required,
    values: (option.product_option_values ?? []).sort(bySortOrder).map((value) => ({
      id: value.id,
      label: value.label,
      priceDeltaCents: value.price_delta_cents,
      isAvailable: value.is_available,
    })),
  }));

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    shortDescription: row.short_description ?? "",
    longDescription: row.long_description ?? "",
    basePriceCents: row.base_price_cents,
    costCents: row.cost_cents,
    category: row.category,
    isAvailable: row.is_available,
    isBestSeller: row.is_best_seller,
    isRecommended: row.is_recommended,
    allergens: row.allergens ?? [],
    dietaryTags: row.dietary_tags ?? [],
    ingredients: parseIngredients(row.ingredients),
    storageInfo: row.storage_info ?? undefined,
    servingInfo: row.serving_info ?? undefined,
    imageUrls: row.image_paths ?? [],
    stockCount: row.stock_count,
    availableFrom: row.available_from,
    photoCount: 3,
    options,
    flavourBox: row.flavour_box ?? null,
    personalisation: row.personalisation_label?.trim()
      ? { label: row.personalisation_label.trim(), allowPhoto: row.personalisation_allow_photo ?? false }
      : null,
  };
}

/**
 * Drop detail-page-only fields (recipe, storage, serving) before shipping a
 * product into a client list. Cards, quick-pick, and menu search never read
 * them, so this trims the RSC/client payload for every card on the page.
 */
export function toCardProduct(product: Product): Product {
  // costCents is admin-only; never ship the bakery's cost to a storefront client.
  return {
    ...product,
    ingredients: [],
    storageInfo: undefined,
    servingInfo: undefined,
    costCents: null,
    // Personalisation is chosen on the detail page, not on cards or quick-pick.
    personalisation: null,
  };
}

/** True when a product has a future go-live time, a seasonal drop not yet open. */
export function isUpcoming(product: Product): boolean {
  return Boolean(product.availableFrom) && new Date(product.availableFrom as string) > new Date();
}

/** All products, ordered as Michelle arranged them. */
export async function fetchProducts(): Promise<Product[]> {
  const supabase = createPublicClient();
  const { data, error } = await supabase
    .from("products")
    .select(PRODUCT_SELECT)
    .order("sort_order", { ascending: true });

  if (error) throw new Error(`Failed to load products: ${error.message}`);
  return ((data as ProductRow[] | null) ?? []).map(rowToProduct);
}

export async function fetchProductBySlug(slug: string): Promise<Product | null> {
  const supabase = createPublicClient();
  const { data, error } = await supabase
    .from("products")
    .select(PRODUCT_SELECT)
    .eq("slug", slug)
    .maybeSingle();

  if (error) throw new Error(`Failed to load product: ${error.message}`);
  if (!data) return null;
  const product = rowToProduct(data as ProductRow);
  // Storefront-facing: the detail page passes the product to client components,
  // so never include the admin-only cost, nor the ingredient amounts (the recipe).
  // Customers see the ingredient names only; keep the other detail fields it shows.
  return {
    ...product,
    costCents: null,
    ingredients: (product.ingredients ?? []).map((i) => ({ name: i.name })),
  };
}

export async function fetchProductById(id: string): Promise<Product | null> {
  const supabase = createPublicClient();
  const { data, error } = await supabase
    .from("products")
    .select(PRODUCT_SELECT)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Failed to load product by id: ${error.message}`);
  return data ? rowToProduct(data as ProductRow) : null;
}

/** Best-sellers first, then recommended via the admin toggle, for the home strip. */
export async function fetchFeatured(limit = 6): Promise<Product[]> {
  const products = await fetchProducts();
  const seen = new Set<string>();
  const featured: Product[] = [];
  for (const product of products) {
    if (!product.isAvailable) continue;
    if ((product.isBestSeller || product.isRecommended) && !seen.has(product.id)) {
      seen.add(product.id);
      featured.push(product);
    }
  }
  // Best-sellers ahead of recommended-only items.
  featured.sort((a, b) => Number(b.isBestSeller) - Number(a.isBestSeller));
  return featured.slice(0, limit);
}

/** "You might also like", same category first, then other available products. */
export async function fetchRelatedProducts(product: Product, limit = 3): Promise<Product[]> {
  const products = await fetchProducts();
  const sameCategory = products.filter(
    (p) => p.id !== product.id && p.isAvailable && p.category === product.category,
  );
  const others = products.filter(
    (p) => p.id !== product.id && p.isAvailable && p.category !== product.category,
  );
  // These render as client ProductCards, so strip detail + cost fields.
  return [...sameCategory, ...others].slice(0, limit).map(toCardProduct);
}
