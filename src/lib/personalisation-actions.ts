"use server";

import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { rateLimit } from "@/lib/rate-limit";
import { validateImageUpload } from "@/lib/image-upload";

export type UploadResult = { ok: true; url: string } | { ok: false; error: string };

/**
 * Uploads a customer's reference photo for a personalisable product. Guests are
 * allowed, since the storefront runs a WhatsApp + PayNow flow with no login, so
 * this is rate-limited and validates type and size. It also checks the product
 * actually enabled photo personalisation, so the public bucket can't be used as
 * open storage. Writes go through the service-role client.
 */
export async function uploadPersonalisationImageAction(formData: FormData): Promise<UploadResult> {
  if (!(await rateLimit("personalisation-upload", { limit: 20, windowMs: 10 * 60_000 }))) {
    return { ok: false, error: "Too many uploads. Please wait a few minutes." };
  }
  const productId = String(formData.get("productId") ?? "");
  const file = formData.get("file");
  if (!productId) return { ok: false, error: "Missing product." };
  if (!(file instanceof File)) return { ok: false, error: "No file provided." };
  const image = validateImageUpload(file);
  if (!image.ok) return { ok: false, error: image.error };

  const admin = createAdminClient();
  const { data } = await admin
    .from("products")
    .select("personalisation_label, personalisation_allow_photo")
    .eq("id", productId)
    .maybeSingle();
  const row = data as
    | { personalisation_label: string | null; personalisation_allow_photo: boolean | null }
    | null;
  if (!row || !row.personalisation_label?.trim() || !row.personalisation_allow_photo) {
    return { ok: false, error: "Photos aren’t available for this item." };
  }

  const path = `${productId}/${randomUUID()}.${image.ext}`;
  const { error } = await admin.storage
    .from("personalisation-images")
    .upload(path, file, { contentType: image.contentType, upsert: false });
  if (error) return { ok: false, error: error.message };
  const { data: pub } = admin.storage.from("personalisation-images").getPublicUrl(path);
  return { ok: true, url: pub.publicUrl };
}
