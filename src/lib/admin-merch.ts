import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

// ---- Bundles ---------------------------------------------------------------
export type AdminBundleItem = { productId: string; productName: string; quantity: number };
export type AdminBundle = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  priceCents: number;
  imageUrl: string | null;
  isActive: boolean;
  sortOrder: number;
  items: AdminBundleItem[];
};
export type NewBundle = Omit<AdminBundle, "id" | "items"> & {
  items: { productId: string; quantity: number }[];
};

type AdminBundleRow = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  price_cents: number;
  image_path: string | null;
  is_active: boolean;
  sort_order: number;
  bundle_items: { product_id: string; quantity: number; products: { name: string } | null }[] | null;
};

const ADMIN_BUNDLE_SELECT =
  "id, name, slug, description, price_cents, image_path, is_active, sort_order, bundle_items(product_id, quantity, products(name))";

export async function fetchAdminBundles(): Promise<AdminBundle[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("bundles")
    .select(ADMIN_BUNDLE_SELECT)
    .order("sort_order", { ascending: true });
  if (error) throw new Error(`Failed to load bundles: ${error.message}`);
  return ((data as unknown as AdminBundleRow[] | null) ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    priceCents: row.price_cents,
    imageUrl: row.image_path,
    isActive: row.is_active,
    sortOrder: row.sort_order,
    items: (row.bundle_items ?? []).map((i) => ({
      productId: i.product_id,
      productName: i.products?.name ?? "Treat",
      quantity: i.quantity,
    })),
  }));
}

/**
 * Swap a bundle's items for a new set. There is no transaction across the delete
 * and the insert, so the old rows are read first and put back if the insert
 * fails. Otherwise a failed save would leave the bundle active and on sale at
 * full price with nothing inside it.
 */
async function replaceBundleItems(
  bundleId: string,
  items: { productId: string; quantity: number }[],
) {
  const supabase = createAdminClient();
  // Build and check the new rows before deleting anything, so a quantity typed
  // wrongly in the admin form can't be the reason the items disappear.
  const rows = items.map((i) => {
    const quantity = Math.max(1, Math.round(i.quantity));
    if (!Number.isFinite(quantity)) {
      throw new Error("Each bundle item needs a quantity of at least 1.");
    }
    return { bundle_id: bundleId, product_id: i.productId, quantity };
  });

  const { data: existing, error: readError } = await supabase
    .from("bundle_items")
    .select("product_id, quantity")
    .eq("bundle_id", bundleId);
  if (readError) throw new Error(`Failed to read bundle items: ${readError.message}`);
  const previous = ((existing as { product_id: string; quantity: number }[] | null) ?? []).map(
    (row) => ({ bundle_id: bundleId, product_id: row.product_id, quantity: row.quantity }),
  );

  const { error: clearError } = await supabase
    .from("bundle_items")
    .delete()
    .eq("bundle_id", bundleId);
  if (clearError) throw new Error(`Failed to save bundle items: ${clearError.message}`);

  if (rows.length === 0) return;
  const { error } = await supabase.from("bundle_items").insert(rows);
  if (error) {
    if (previous.length > 0) await supabase.from("bundle_items").insert(previous);
    throw new Error(`Failed to save bundle items: ${error.message}`);
  }
}

export async function createBundle(input: NewBundle): Promise<void> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("bundles")
    .insert({
      name: input.name,
      slug: input.slug,
      description: input.description,
      price_cents: input.priceCents,
      image_path: input.imageUrl,
      is_active: input.isActive,
      sort_order: input.sortOrder,
    })
    .select("id")
    .single();
  if (error) throw new Error(`Failed to create bundle: ${error.message}`);
  const bundleId = (data as { id: string }).id;
  try {
    await replaceBundleItems(bundleId, input.items);
  } catch (e) {
    // The bundle row is already saved, so drop it rather than leave an active
    // bundle on the storefront with no items in it.
    await supabase.from("bundles").delete().eq("id", bundleId);
    throw e;
  }
}

export async function updateBundle(id: string, input: NewBundle): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("bundles")
    .update({
      name: input.name,
      slug: input.slug,
      description: input.description,
      price_cents: input.priceCents,
      image_path: input.imageUrl,
      is_active: input.isActive,
      sort_order: input.sortOrder,
    })
    .eq("id", id);
  if (error) throw new Error(`Failed to update bundle: ${error.message}`);
  await replaceBundleItems(id, input.items);
}

export async function deleteBundle(id: string): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase.from("bundles").delete().eq("id", id);
  if (error) throw new Error(`Failed to delete bundle: ${error.message}`);
}

// ---- Build-a-box templates -------------------------------------------------
export type AdminBoxTemplate = {
  id: string;
  name: string;
  slug: string;
  itemCount: number;
  priceCents: number;
  eligibleCategory: string | null;
  isActive: boolean;
  sortOrder: number;
  productIds: string[];
};
export type NewBoxTemplate = Omit<AdminBoxTemplate, "id">;

type AdminBoxRow = {
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

const ADMIN_BOX_SELECT =
  "id, name, slug, item_count, price_cents, eligible_category, is_active, sort_order, box_template_items(product_id)";

export async function fetchAdminBoxTemplates(): Promise<AdminBoxTemplate[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("box_templates")
    .select(ADMIN_BOX_SELECT)
    .order("sort_order", { ascending: true });
  if (error) throw new Error(`Failed to load box templates: ${error.message}`);
  return ((data as unknown as AdminBoxRow[] | null) ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    itemCount: row.item_count,
    priceCents: row.price_cents,
    eligibleCategory: row.eligible_category,
    isActive: row.is_active,
    sortOrder: row.sort_order,
    productIds: (row.box_template_items ?? []).map((i) => i.product_id),
  }));
}

/** Same delete-then-insert swap as bundles, and the same restore if it fails, so
 *  a box is never left active with none of its products ticked. */
async function replaceBoxItems(boxId: string, productIds: string[]) {
  const supabase = createAdminClient();
  const { data: existing, error: readError } = await supabase
    .from("box_template_items")
    .select("product_id")
    .eq("box_template_id", boxId);
  if (readError) throw new Error(`Failed to read box items: ${readError.message}`);
  const previous = ((existing as { product_id: string }[] | null) ?? []).map((row) => ({
    box_template_id: boxId,
    product_id: row.product_id,
  }));

  const { error: clearError } = await supabase
    .from("box_template_items")
    .delete()
    .eq("box_template_id", boxId);
  if (clearError) throw new Error(`Failed to save box items: ${clearError.message}`);

  if (productIds.length === 0) return;
  const rows = productIds.map((productId) => ({
    box_template_id: boxId,
    product_id: productId,
  }));
  const { error } = await supabase.from("box_template_items").insert(rows);
  if (error) {
    if (previous.length > 0) await supabase.from("box_template_items").insert(previous);
    throw new Error(`Failed to save box items: ${error.message}`);
  }
}

export async function createBoxTemplate(input: NewBoxTemplate): Promise<void> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("box_templates")
    .insert({
      name: input.name,
      slug: input.slug,
      item_count: input.itemCount,
      price_cents: input.priceCents,
      eligible_category: input.eligibleCategory,
      is_active: input.isActive,
      sort_order: input.sortOrder,
    })
    .select("id")
    .single();
  if (error) throw new Error(`Failed to create box: ${error.message}`);
  const boxId = (data as { id: string }).id;
  try {
    await replaceBoxItems(boxId, input.productIds);
  } catch (e) {
    // Drop the half-made box rather than leave one live with no products.
    await supabase.from("box_templates").delete().eq("id", boxId);
    throw e;
  }
}

export async function updateBoxTemplate(id: string, input: NewBoxTemplate): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("box_templates")
    .update({
      name: input.name,
      slug: input.slug,
      item_count: input.itemCount,
      price_cents: input.priceCents,
      eligible_category: input.eligibleCategory,
      is_active: input.isActive,
      sort_order: input.sortOrder,
    })
    .eq("id", id);
  if (error) throw new Error(`Failed to update box: ${error.message}`);
  await replaceBoxItems(id, input.productIds);
}

export async function deleteBoxTemplate(id: string): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase.from("box_templates").delete().eq("id", id);
  if (error) throw new Error(`Failed to delete box: ${error.message}`);
}
