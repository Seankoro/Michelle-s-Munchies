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

async function replaceBundleItems(
  bundleId: string,
  items: { productId: string; quantity: number }[],
) {
  const supabase = createAdminClient();
  await supabase.from("bundle_items").delete().eq("bundle_id", bundleId);
  if (items.length > 0) {
    const rows = items.map((i) => ({
      bundle_id: bundleId,
      product_id: i.productId,
      quantity: Math.max(1, i.quantity),
    }));
    const { error } = await supabase.from("bundle_items").insert(rows);
    if (error) throw new Error(`Failed to save bundle items: ${error.message}`);
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
  await replaceBundleItems((data as { id: string }).id, input.items);
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

async function replaceBoxItems(boxId: string, productIds: string[]) {
  const supabase = createAdminClient();
  await supabase.from("box_template_items").delete().eq("box_template_id", boxId);
  if (productIds.length > 0) {
    const rows = productIds.map((productId) => ({
      box_template_id: boxId,
      product_id: productId,
    }));
    const { error } = await supabase.from("box_template_items").insert(rows);
    if (error) throw new Error(`Failed to save box items: ${error.message}`);
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
  await replaceBoxItems((data as { id: string }).id, input.productIds);
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
