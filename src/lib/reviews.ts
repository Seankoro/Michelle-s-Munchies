import "server-only";
import { createPublicClient } from "@/lib/supabase/public";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export type Review = {
  rating: number;
  body: string | null;
  authorName: string | null;
  createdAt: string;
  imageUrls: string[];
};

type ReviewRow = {
  rating: number;
  body: string | null;
  author_name: string | null;
  created_at: string;
  image_paths: string[] | null;
};

/** All reviews for a product, public and shown on the product page. Reads go
 *  through the column-limited public_product_reviews view so account ids never
 *  reach the anon key. */
export async function fetchReviews(productId: string): Promise<Review[]> {
  const supabase = createPublicClient();
  const { data, error } = await supabase
    .from("public_product_reviews")
    .select("rating, body, author_name, created_at, image_paths")
    .eq("product_id", productId)
    .order("created_at", { ascending: false });
  if (error) return [];
  return ((data as ReviewRow[] | null) ?? []).map((r) => ({
    rating: r.rating,
    body: r.body,
    authorName: r.author_name,
    createdAt: r.created_at,
    imageUrls: r.image_paths ?? [],
  }));
}

export type RatingSummary = { avg: number; count: number };

/**
 * Average rating and count per product in one query, for star lines on menu
 * cards. Products with no reviews are simply absent from the map.
 */
export async function fetchAllRatings(): Promise<Record<string, RatingSummary>> {
  const supabase = createPublicClient();
  const { data, error } = await supabase
    .from("public_product_reviews")
    .select("product_id, rating");
  if (error) return {};
  const totals: Record<string, { sum: number; count: number }> = {};
  for (const row of (data as { product_id: string; rating: number }[] | null) ?? []) {
    const entry = (totals[row.product_id] ??= { sum: 0, count: 0 });
    entry.sum += row.rating;
    entry.count += 1;
  }
  return Object.fromEntries(
    Object.entries(totals).map(([id, t]) => [id, { avg: t.sum / t.count, count: t.count }]),
  );
}

export type ReviewHighlights = {
  avg: number;
  count: number;
  quotes: { rating: number; body: string; authorName: string }[];
};

/**
 * Overall rating and a few recent quotes for home-page social proof. Only 4-5
 * star reviews with a written note are quoted; the average and count span all.
 */
export async function fetchReviewHighlights(maxQuotes = 3): Promise<ReviewHighlights> {
  const supabase = createPublicClient();
  const { data, error } = await supabase
    .from("public_product_reviews")
    .select("rating, body, author_name, created_at")
    .order("created_at", { ascending: false });
  if (error) return { avg: 0, count: 0, quotes: [] };
  const rows =
    (data as
      | { rating: number; body: string | null; author_name: string | null }[]
      | null) ?? [];
  const count = rows.length;
  const avg = count ? rows.reduce((sum, r) => sum + r.rating, 0) / count : 0;
  const quotes = rows
    .filter((r) => r.rating >= 4 && (r.body ?? "").trim().length > 0)
    .slice(0, maxQuotes)
    .map((r) => ({
      rating: r.rating,
      body: (r.body ?? "").trim(),
      authorName: r.author_name ?? "A customer",
    }));
  return { avg, count, quotes };
}

export type ReviewContext = {
  signedIn: boolean;
  canReview: boolean;
  existing: { rating: number; body: string } | null;
};

/** Whether a user has a paid order containing this product, the verified-buyer gate. */
async function hasPaidPurchase(userId: string, productId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data: paidOrders } = await admin
    .from("orders")
    .select("id")
    .eq("user_id", userId)
    .eq("payment_status", "paid");
  const orderIds = ((paidOrders as { id: string }[] | null) ?? []).map((o) => o.id);
  if (orderIds.length === 0) return false;
  const { data: items } = await admin
    .from("order_items")
    .select("id")
    .eq("product_id", productId)
    .in("order_id", orderIds)
    .limit(1);
  return ((items as { id: string }[] | null) ?? []).length > 0;
}

/** Whether the current user may review this product, signed in with a paid purchase. */
export async function getReviewContext(productId: string): Promise<ReviewContext> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { signedIn: false, canReview: false, existing: null };

  const canReview = await hasPaidPurchase(user.id, productId);

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("reviews")
    .select("rating, body")
    .eq("product_id", productId)
    .eq("user_id", user.id)
    .maybeSingle();
  const existingReview = existing as { rating: number; body: string | null } | null;

  return {
    signedIn: true,
    canReview,
    existing: existingReview
      ? { rating: existingReview.rating, body: existingReview.body ?? "" }
      : null,
  };
}

/** Verifies the buyer and upserts their review. Used by the submitReview action. */
export async function upsertReview(
  userId: string,
  productId: string,
  rating: number,
  body: string,
  imageUrls: string[] = [],
): Promise<{ ok: true } | { error: string }> {
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return { error: "Please choose a rating from 1 to 5." };
  }

  if (!(await hasPaidPurchase(userId, productId))) {
    return { error: "Only verified buyers can review this item." };
  }

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("full_name")
    .eq("id", userId)
    .single();
  const authorName = (profile as { full_name: string | null } | null)?.full_name ?? "Customer";

  const { error } = await admin.from("reviews").upsert(
    {
      product_id: productId,
      user_id: userId,
      rating,
      body: body.trim() || null,
      author_name: authorName,
      image_paths: imageUrls,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "product_id,user_id" },
  );
  if (error) return { error: error.message };
  return { ok: true };
}
