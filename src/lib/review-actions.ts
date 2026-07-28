"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchStoreSettings } from "@/lib/settings";
import { upsertReview } from "@/lib/reviews";
import { validateImageUpload } from "@/lib/image-upload";
import { rateLimit } from "@/lib/rate-limit";

export type ReviewResult = { ok: true } | { error: string };

/** Never trust more than a few photos per review. */
const MAX_REVIEW_IMAGES = 3;
/** Generous headroom over a real `{supabase-url}/.../{uuid}/{uuid}.ext` URL. */
const MAX_IMAGE_URL_LENGTH = 300;

/**
 * Drop any imageUrl that doesn't point at this user's own folder in the
 * `review-images` public bucket, so a submitted review can't reference
 * unrelated storage objects, and cap the count so the gallery can't be
 * bloated with an unbounded number of entries.
 */
function sanitizeReviewImageUrls(userId: string, imageUrls: string[]): string[] {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) return [];
  const prefix = `${supabaseUrl}/storage/v1/object/public/review-images/${userId}/`;
  // After the user's own folder a real upload is a single `{uuid}.{ext}` file, so
  // require exactly that shape. It rejects path traversal like
  // `.../<uid>/../../avatars/x.png`, which would otherwise pass a bare startsWith.
  const fileName = /^[a-z0-9-]+\.[a-z0-9]+$/i;
  return imageUrls
    .filter((url): url is string => typeof url === "string")
    .filter(
      (url) =>
        url.length > 0 &&
        url.length <= MAX_IMAGE_URL_LENGTH &&
        url.startsWith(prefix) &&
        fileName.test(url.slice(prefix.length)),
    )
    .slice(0, MAX_REVIEW_IMAGES);
}

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
  if (!(await rateLimit("submit-review", { limit: 8, windowMs: 10 * 60_000 }))) {
    return { error: "You’re submitting too quickly. Please wait a few minutes and try again." };
  }

  // Photos only when the photo-reviews feature is on, and only ones that are
  // genuinely this user's own uploads to the review-images bucket.
  const photos = settings.features.photoReviews
    ? sanitizeReviewImageUrls(user.id, imageUrls)
    : [];
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
  if (!(await rateLimit("review-image-upload", { limit: 12, windowMs: 10 * 60_000 }))) {
    return { ok: false, error: "You’re uploading too quickly. Please wait a few minutes and try again." };
  }

  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "No file provided." };
  const image = validateImageUpload(file);
  if (!image.ok) return { ok: false, error: image.error };

  const path = `${user.id}/${randomUUID()}.${image.ext}`;
  const admin = createAdminClient();
  const { error } = await admin.storage
    .from("review-images")
    .upload(path, file, { contentType: image.contentType, upsert: false });
  if (error) return { ok: false, error: error.message };
  const { data } = admin.storage.from("review-images").getPublicUrl(path);
  return { ok: true, url: data.publicUrl };
}
