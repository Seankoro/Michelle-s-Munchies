"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchStoreSettings } from "@/lib/settings";
import { upsertReview } from "@/lib/reviews";

export type ReviewResult = { ok: true } | { error: string };

export async function submitReview(
  slug: string,
  productId: string,
  rating: number,
  body: string,
  imageUrls: string[] = [],
): Promise<ReviewResult> {
  const settings = await fetchStoreSettings();
  if (!settings.features.reviews) {
    return { error: "Reviews are currently turned off." };
  }
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Please sign in to leave a review." };

  // Photos only when the photo-reviews feature is on.
  const photos = settings.features.photoReviews ? imageUrls : [];
  const result = await upsertReview(user.id, productId, rating, body, photos);
  if ("ok" in result) revalidatePath(`/menu/${slug}`);
  return result;
}

export type UploadResult = { ok: true; url: string } | { ok: false; error: string };

/**
 * Uploads a review photo to the public `review-images` bucket. Requires a
 * signed-in user and the photo-reviews feature, and validates type and size.
 * Uses the service-role client so writes are server-controlled.
 */
export async function uploadReviewImageAction(formData: FormData): Promise<UploadResult> {
  if (!(await fetchStoreSettings()).features.photoReviews) {
    return { ok: false, error: "Photo reviews aren’t available right now." };
  }
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Please sign in first." };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "No file provided." };
  if (!file.type.startsWith("image/")) return { ok: false, error: "Please choose an image file." };
  if (file.size > 5 * 1024 * 1024) return { ok: false, error: "Image must be under 5 MB." };

  const ext = (file.name.split(".").pop() ?? "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const path = `${user.id}/${randomUUID()}.${ext}`;
  const admin = createAdminClient();
  const { error } = await admin.storage
    .from("review-images")
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) return { ok: false, error: error.message };
  const { data } = admin.storage.from("review-images").getPublicUrl(path);
  return { ok: true, url: data.publicUrl };
}
