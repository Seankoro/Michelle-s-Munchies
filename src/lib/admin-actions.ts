"use server";

import { randomUUID } from "node:crypto";
import { fetchProducts } from "@/lib/products";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";
import { isAdminEmail, requireAdmin } from "@/lib/admin-auth";
import {
  cancelAndRefundOrder,
  createProduct,
  createPromo,
  deletePromo,
  deleteProduct,
  fetchAdminOrders,
  fetchAdminSettings,
  fetchPromos,
  setPromoActive,
  updateOrderStatus,
  updatePaymentStatus,
  updateProduct,
  updateSettings,
  type CancelResult,
  type NewPromo,
  type PromoCode,
} from "@/lib/admin-db";
import {
  createBundle,
  deleteBundle,
  fetchAdminBundles,
  updateBundle,
  createBoxTemplate,
  deleteBoxTemplate,
  fetchAdminBoxTemplates,
  updateBoxTemplate,
  type AdminBundle,
  type NewBundle,
  type AdminBoxTemplate,
  type NewBoxTemplate,
} from "@/lib/admin-merch";
import {
  createInstagramPost,
  deleteInstagramPost,
  fetchAdminInstagramPosts,
  updateInstagramPost,
  type AdminInstagramPost,
  type NewInstagramPost,
} from "@/lib/admin-content";
import type { AdminSettings } from "@/components/admin/AdminStore";
import type { AdminOrder, OrderStatus, PaymentStatus } from "@/lib/order";
import type { Product } from "@/lib/types";

export type AdminSignInResult = { ok: true } | { ok: false; error: string };

/** Admin sign-in: authenticate via Supabase, then require the admin allow-list. */
export async function adminSignIn(email: string, password: string): Promise<AdminSignInResult> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { ok: false, error: error.message };
  if (!isAdminEmail(data.user?.email)) {
    await supabase.auth.signOut();
    return { ok: false, error: "This account doesn’t have admin access." };
  }
  return { ok: true };
}

export async function loadAdminData(): Promise<{
  products: Product[];
  orders: AdminOrder[];
  settings: AdminSettings;
}> {
  await requireAdmin();
  const [products, orders, settings] = await Promise.all([
    fetchProducts(),
    fetchAdminOrders(),
    fetchAdminSettings(),
  ]);
  return { products, orders, settings };
}

export async function createProductAction(product: Product): Promise<Product> {
  await requireAdmin();
  return createProduct(product);
}

export async function updateProductAction(id: string, patch: Partial<Product>): Promise<void> {
  await requireAdmin();
  await updateProduct(id, patch);
}

export async function deleteProductAction(id: string): Promise<void> {
  await requireAdmin();
  await deleteProduct(id);
}

export async function updateOrderStatusAction(
  orderNumber: string,
  status: OrderStatus,
): Promise<void> {
  await requireAdmin();
  await updateOrderStatus(orderNumber, status);
}

export async function updatePaymentStatusAction(
  orderNumber: string,
  paymentStatus: PaymentStatus,
): Promise<void> {
  await requireAdmin();
  await updatePaymentStatus(orderNumber, paymentStatus);
}

export async function cancelOrderAction(orderNumber: string): Promise<CancelResult> {
  await requireAdmin();
  return cancelAndRefundOrder(orderNumber);
}

export async function updateSettingsAction(patch: Partial<AdminSettings>): Promise<void> {
  await requireAdmin();
  await updateSettings(patch);
}

// ---- Promo codes -----------------------------------------------------------
export async function loadPromosAction(): Promise<PromoCode[]> {
  await requireAdmin();
  return fetchPromos();
}

export type CreatePromoResult =
  | { ok: true; promo: PromoCode }
  | { ok: false; error: string };

export async function createPromoAction(input: NewPromo): Promise<CreatePromoResult> {
  await requireAdmin();
  const code = input.code.trim().toUpperCase();
  if (!/^[A-Z0-9]{3,20}$/.test(code)) {
    return { ok: false, error: "Code must be 3–20 letters/numbers, no spaces." };
  }
  if (input.discountType === "percent") {
    if (input.discountValue < 1 || input.discountValue > 100) {
      return { ok: false, error: "Percent must be between 1 and 100." };
    }
  } else if (input.discountType === "amount") {
    if (input.discountValue < 1) {
      return { ok: false, error: "Amount must be greater than zero." };
    }
  }
  if (input.minOrderCents < 0) {
    return { ok: false, error: "Minimum order can’t be negative." };
  }
  if (input.maxRedemptions != null && input.maxRedemptions < 1) {
    return { ok: false, error: "Max redemptions must be at least 1." };
  }
  if (input.perCustomerLimit != null && input.perCustomerLimit < 1) {
    return { ok: false, error: "Per-customer limit must be at least 1." };
  }
  try {
    const promo = await createPromo({ ...input, code });
    return { ok: true, promo };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not create code.",
    };
  }
}

export async function setPromoActiveAction(id: string, active: boolean): Promise<void> {
  await requireAdmin();
  await setPromoActive(id, active);
}

// ---- Product image upload --------------------------------------------------
export type UploadResult = { ok: true; url: string } | { ok: false; error: string };

/**
 * Uploads a product photo to the public `product-images` bucket and returns its
 * public URL. Uses the service-role client, so it must be admin-gated.
 */
export async function uploadProductImageAction(formData: FormData): Promise<UploadResult> {
  await requireAdmin();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "No file provided." };
  }
  if (!file.type.startsWith("image/")) {
    return { ok: false, error: "Please choose an image file." };
  }
  if (file.size > 5 * 1024 * 1024) {
    return { ok: false, error: "Image must be under 5 MB." };
  }
  const ext = (file.name.split(".").pop() ?? "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const path = `${randomUUID()}.${ext}`;
  const supabase = createAdminClient();
  const { error } = await supabase.storage
    .from("product-images")
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) return { ok: false, error: error.message };
  const { data } = supabase.storage.from("product-images").getPublicUrl(path);
  return { ok: true, url: data.publicUrl };
}

export async function deletePromoAction(id: string): Promise<void> {
  await requireAdmin();
  await deletePromo(id);
}

// ---- Bundles ---------------------------------------------------------------
export async function loadBundlesAction(): Promise<AdminBundle[]> {
  await requireAdmin();
  return fetchAdminBundles();
}

export type SaveBundleResult = { ok: true } | { ok: false; error: string };

function validateBundleInput(input: NewBundle): string | null {
  if (!input.name.trim()) return "Name is required.";
  if (!/^[a-z0-9-]{3,40}$/.test(input.slug)) return "Slug must be 3–40 lowercase letters/numbers/dashes.";
  if (input.priceCents < 0) return "Price can’t be negative.";
  if (input.items.length === 0) return "Add at least one item to the bundle.";
  return null;
}

export async function createBundleAction(input: NewBundle): Promise<SaveBundleResult> {
  await requireAdmin();
  const err = validateBundleInput(input);
  if (err) return { ok: false, error: err };
  try {
    await createBundle(input);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not save bundle." };
  }
}

export async function updateBundleAction(id: string, input: NewBundle): Promise<SaveBundleResult> {
  await requireAdmin();
  const err = validateBundleInput(input);
  if (err) return { ok: false, error: err };
  try {
    await updateBundle(id, input);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not save bundle." };
  }
}

export async function deleteBundleAction(id: string): Promise<void> {
  await requireAdmin();
  await deleteBundle(id);
}

// ---- Build-a-box templates -------------------------------------------------
export async function loadBoxTemplatesAction(): Promise<AdminBoxTemplate[]> {
  await requireAdmin();
  return fetchAdminBoxTemplates();
}

export type SaveBoxResult = { ok: true } | { ok: false; error: string };

function validateBoxInput(input: NewBoxTemplate): string | null {
  if (!input.name.trim()) return "Name is required.";
  if (!/^[a-z0-9-]{3,40}$/.test(input.slug)) return "Slug must be 3–40 lowercase letters/numbers/dashes.";
  if (input.itemCount < 1) return "Item count must be at least 1.";
  if (input.priceCents < 0) return "Price can’t be negative.";
  if (input.productIds.length === 0 && !input.eligibleCategory) {
    return "Pick eligible products or a category.";
  }
  return null;
}

export async function createBoxTemplateAction(input: NewBoxTemplate): Promise<SaveBoxResult> {
  await requireAdmin();
  const err = validateBoxInput(input);
  if (err) return { ok: false, error: err };
  try {
    await createBoxTemplate(input);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not save box." };
  }
}

export async function updateBoxTemplateAction(
  id: string,
  input: NewBoxTemplate,
): Promise<SaveBoxResult> {
  await requireAdmin();
  const err = validateBoxInput(input);
  if (err) return { ok: false, error: err };
  try {
    await updateBoxTemplate(id, input);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not save box." };
  }
}

export async function deleteBoxTemplateAction(id: string): Promise<void> {
  await requireAdmin();
  await deleteBoxTemplate(id);
}

// ---- Instagram posts -------------------------------------------------------
export async function loadInstagramPostsAction(): Promise<AdminInstagramPost[]> {
  await requireAdmin();
  return fetchAdminInstagramPosts();
}

export type SaveInstagramResult = { ok: true } | { ok: false; error: string };

function validateInstagramInput(input: NewInstagramPost): string | null {
  if (!/^https?:\/\/.+/i.test(input.imageUrl)) return "Image URL must start with http(s)://";
  if (!/^https?:\/\/.+/i.test(input.linkUrl)) return "Link URL must start with http(s)://";
  return null;
}

export async function createInstagramPostAction(
  input: NewInstagramPost,
): Promise<SaveInstagramResult> {
  await requireAdmin();
  const err = validateInstagramInput(input);
  if (err) return { ok: false, error: err };
  try {
    await createInstagramPost(input);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not save post." };
  }
}

export async function updateInstagramPostAction(
  id: string,
  input: NewInstagramPost,
): Promise<SaveInstagramResult> {
  await requireAdmin();
  const err = validateInstagramInput(input);
  if (err) return { ok: false, error: err };
  try {
    await updateInstagramPost(id, input);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not save post." };
  }
}

export async function deleteInstagramPostAction(id: string): Promise<void> {
  await requireAdmin();
  await deleteInstagramPost(id);
}
