"use server";

import { randomUUID } from "node:crypto";
import { fetchAdminProducts } from "@/lib/products";
import { createManualOrder, type ManualOrderInput } from "@/lib/orders-db";
import { validateImageUpload } from "@/lib/image-upload";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";
import { isAdminEmail, requireAdmin } from "@/lib/admin-auth";
import { rateLimit } from "@/lib/rate-limit";
import { fetchDeliveryConfig, updateDeliveryConfig, type DeliveryConfig } from "@/lib/delivery-config";
import { geocodePostal } from "@/lib/onemap";
import type { DistanceTier } from "@/lib/delivery-fee";
import {
  cancelAndRefundOrder,
  createProduct,
  createPromo,
  deletePromo,
  deleteProduct,
  fetchAdminOrders,
  fetchAdminSettings,
  fetchPromos,
  recordDeposit,
  rescheduleOrder,
  setPromoActive,
  updateOrderStatus,
  updateOwnerNote,
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

/** The same words for every failed admin sign-in. A raw Supabase error tells an
 *  attacker whether the password was wrong or the account merely unconfirmed,
 *  and a separate "not an admin" line would confirm that a guessed email and
 *  password really are a working login. */
const ADMIN_SIGN_IN_FAILED = "That email or password is not right.";

/** Admin sign-in, authenticate via Supabase, then require the admin allow-list. */
export async function adminSignIn(email: string, password: string): Promise<AdminSignInResult> {
  // This one password is the only gate on orders, customer details, refunds and
  // settings, so the form gets two counters. The per-IP one stops a single
  // source hammering it. The per-address one is keyed on the email alone, so
  // rotating IPs can't hand out a fresh budget for every guess. It stays loose
  // enough that Michelle's own mistyped attempts never trip it.
  if (!(await rateLimit("admin-sign-in", { limit: 5, windowMs: 15 * 60_000 }))) {
    return { ok: false, error: "Too many attempts. Please wait a few minutes." };
  }
  const normalizedEmail = email.trim().toLowerCase();
  if (
    normalizedEmail &&
    !(await rateLimit(`admin-sign-in:${normalizedEmail}`, {
      limit: 20,
      windowMs: 60 * 60_000,
      scope: "global",
    }))
  ) {
    return { ok: false, error: "Too many attempts. Please wait a few minutes." };
  }
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { ok: false, error: ADMIN_SIGN_IN_FAILED };
  if (!isAdminEmail(data.user?.email)) {
    await supabase.auth.signOut();
    return { ok: false, error: ADMIN_SIGN_IN_FAILED };
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
    fetchAdminProducts(),
    fetchAdminOrders(),
    fetchAdminSettings(),
  ]);
  return { products, orders, settings };
}

const PRODUCT_SLUG_PATTERN = /^[a-z0-9-]{3,40}$/;

/** Shared by create and update so a product can never save with a blank name
 *  or a slug that doesn't match the format every other admin form enforces. */
function validateProductInput(input: { name: string; slug: string }): string | null {
  if (!input.name.trim()) return "Name is required.";
  if (!PRODUCT_SLUG_PATTERN.test(input.slug)) {
    return "Slug must be 3–40 lowercase letters, numbers, and dashes.";
  }
  return null;
}

export async function createProductAction(product: Product): Promise<Product> {
  await requireAdmin();
  const err = validateProductInput(product);
  if (err) throw new Error(err);
  const existing = await fetchAdminProducts();
  if (existing.some((p) => p.slug === product.slug)) {
    throw new Error(`A product with the slug "${product.slug}" already exists.`);
  }
  return createProduct(product);
}

export async function updateProductAction(id: string, patch: Partial<Product>): Promise<void> {
  await requireAdmin();
  if (patch.name !== undefined && !patch.name.trim()) {
    throw new Error("Name is required.");
  }
  if (patch.slug !== undefined) {
    if (!PRODUCT_SLUG_PATTERN.test(patch.slug)) {
      throw new Error("Slug must be 3–40 lowercase letters, numbers, and dashes.");
    }
    const existing = await fetchAdminProducts();
    if (existing.some((p) => p.id !== id && p.slug === patch.slug)) {
      throw new Error(`A product with the slug "${patch.slug}" already exists.`);
    }
  }
  await updateProduct(id, patch);
}

export async function deleteProductAction(id: string): Promise<void> {
  await requireAdmin();
  // A bundle's foreign key on products is RESTRICT, so a raw delete here
  // fails with a cryptic Postgres constraint error. Check for that first and
  // name the bundles, so the owner knows exactly what to fix.
  const bundles = await fetchAdminBundles();
  const usedIn = bundles.filter((b) => b.items.some((item) => item.productId === id));
  if (usedIn.length > 0) {
    throw new Error(
      `Remove this product from its bundles first (${usedIn.map((b) => b.name).join(", ")}).`,
    );
  }
  try {
    await deleteProduct(id);
  } catch (error) {
    if (error instanceof Error && /foreign key/i.test(error.message)) {
      throw new Error("Remove this product from its bundles first.");
    }
    throw error;
  }
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

export async function updateOwnerNoteAction(orderNumber: string, note: string): Promise<void> {
  await requireAdmin();
  await updateOwnerNote(orderNumber, note);
}

export async function rescheduleOrderAdminAction(
  orderNumber: string,
  date: string,
  timeWindow: string,
): Promise<void> {
  await requireAdmin();
  await rescheduleOrder(orderNumber, date, timeWindow);
}

export async function recordDepositAction(orderNumber: string, cents: number): Promise<void> {
  await requireAdmin();
  await recordDeposit(orderNumber, cents);
}

export async function cancelOrderAction(orderNumber: string): Promise<CancelResult> {
  await requireAdmin();
  return cancelAndRefundOrder(orderNumber);
}

export type ManualOrderResult = { ok: true; orderNumber: string } | { ok: false; error: string };

export async function createManualOrderAction(input: ManualOrderInput): Promise<ManualOrderResult> {
  await requireAdmin();
  if (!input.name.trim()) return { ok: false, error: "Add the customer's name." };
  if (!input.scheduledDate) return { ok: false, error: "Pick a date." };
  if (!input.timeWindow) return { ok: false, error: "Pick a time window." };
  if (input.items.length === 0) return { ok: false, error: "Add at least one item." };
  if (input.fulfillmentType === "delivery") {
    if (!input.address?.line1?.trim()) {
      return { ok: false, error: "Add the delivery address." };
    }
    if (!/^\d{6}$/.test(input.address?.postalCode?.trim() ?? "")) {
      return { ok: false, error: "Postal code must be 6 digits." };
    }
  }
  try {
    const { orderNumber } = await createManualOrder(input);
    return { ok: true, orderNumber };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not create the order.",
    };
  }
}

export async function updateSettingsAction(patch: Partial<AdminSettings>): Promise<void> {
  await requireAdmin();
  await updateSettings(patch);
}

// ---- Delivery zones ---------------------------------------------------------
// Kitchen coordinates and distance tiers live in the service-role-only
// delivery_config table, never on the public settings row, because the
// coordinates are effectively the owner's home address. Only these
// admin-gated actions may read or write it.
export async function loadDeliveryConfigAction(): Promise<DeliveryConfig> {
  await requireAdmin();
  return fetchDeliveryConfig();
}

export type SaveDeliveryConfigResult =
  | { ok: true; config: DeliveryConfig }
  | { ok: false; error: string };

export async function saveDeliveryConfigAction(input: {
  kitchenPostal: string;
  tiers: DistanceTier[];
}): Promise<SaveDeliveryConfigResult> {
  await requireAdmin();
  const kitchenPostal = input.kitchenPostal.trim();
  if (kitchenPostal && !/^\d{6}$/.test(kitchenPostal)) {
    return { ok: false, error: "Kitchen postal code must be 6 digits." };
  }
  for (let i = 0; i < input.tiers.length; i++) {
    const tier = input.tiers[i];
    if (!Number.isFinite(tier.upToKm) || tier.upToKm <= 0) {
      return { ok: false, error: `Tier ${i + 1}: distance must be a number greater than zero.` };
    }
    if (!Number.isInteger(tier.feeCents) || tier.feeCents < 0) {
      return { ok: false, error: `Tier ${i + 1}: fee must be a whole number of cents that is zero or more.` };
    }
  }
  const tiers = [...input.tiers].sort((a, b) => a.upToKm - b.upToKm);

  try {
    const current = await fetchDeliveryConfig();
    let kitchenLat: number | null = current.kitchenLat;
    let kitchenLng: number | null = current.kitchenLng;
    if (!kitchenPostal) {
      kitchenLat = null;
      kitchenLng = null;
    } else if (kitchenPostal !== current.kitchenPostal || kitchenLat == null || kitchenLng == null) {
      const coords = await geocodePostal(kitchenPostal);
      kitchenLat = coords?.lat ?? null;
      kitchenLng = coords?.lng ?? null;
    }
    await updateDeliveryConfig({
      kitchenPostal: kitchenPostal || null,
      kitchenLat,
      kitchenLng,
      tiers,
    });
    return { ok: true, config: await fetchDeliveryConfig() };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not save delivery zones.",
    };
  }
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
  if (!(file instanceof File)) {
    return { ok: false, error: "No file provided." };
  }
  const image = validateImageUpload(file);
  if (!image.ok) return { ok: false, error: image.error };

  const path = `${randomUUID()}.${image.ext}`;
  const supabase = createAdminClient();
  const { error } = await supabase.storage
    .from("product-images")
    .upload(path, file, { contentType: image.contentType, upsert: false });
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
  // A box nobody can finish is hidden from the storefront rather than shown as
  // a dead end, so saving one asking for more picks than it has products would
  // look like a success and then quietly never appear anywhere.
  if (input.productIds.length > 0 && input.productIds.length < input.itemCount) {
    return `This box asks for ${input.itemCount} items but only ${input.productIds.length} products are ticked. Lower the item count or tick more products.`;
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

/** A photo uploaded by the form lands at the bucket root as `{uuid}.{ext}`. */
const UPLOADED_FILE_PATTERN = /^[a-z0-9-]+\.[a-z0-9]+$/i;

/** The photo has to be one of our own uploads in the public `product-images`
 *  bucket, which is what the form's uploader saves. A pasted Instagram CDN link
 *  would save happily and then show as a broken tile, because the CSP only
 *  allows images from Supabase and Instagram's links expire anyway. Checking the
 *  file name as well as the prefix rejects path traversal like
 *  `.../product-images/../../avatars/x.png`, which a bare startsWith allows. */
function validateInstagramInput(input: NewInstagramPost): string | null {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const prefix = `${supabaseUrl}/storage/v1/object/public/product-images/`;
  if (
    !supabaseUrl ||
    !input.imageUrl.startsWith(prefix) ||
    !UPLOADED_FILE_PATTERN.test(input.imageUrl.slice(prefix.length))
  ) {
    return "Add the photo with the upload button. A pasted image link won’t load on the site.";
  }
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
