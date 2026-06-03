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

/** All reviews for a product (public — shown on the product page). */
export async function fetchReviews(productId: string): Promise<Review[]> {
  const supabase = createPublicClient();
  const { data, error } = await supabase
    .from("reviews")
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

export type ReviewContext = {
  signedIn: boolean;
  canReview: boolean;
  existing: { rating: number; body: string } | null;
};

/** Whether the current user may review this product (signed in + paid purchase). */
export async function getReviewContext(productId: string): Promise<ReviewContext> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { signedIn: false, canReview: false, existing: null };

  const admin = createAdminClient();

  const { data: paidOrders } = await admin
    .from("orders")
    .select("id")
    .eq("user_id", user.id)
    .eq("payment_status", "paid");
  const orderIds = ((paidOrders as { id: string }[] | null) ?? []).map((o) => o.id);

  let canReview = false;
  if (orderIds.length > 0) {
    const { data: items } = await admin
      .from("order_items")
      .select("id")
      .eq("product_id", productId)
      .in("order_id", orderIds)
      .limit(1);
    canReview = ((items as { id: string }[] | null) ?? []).length > 0;
  }

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
  if (rating < 1 || rating > 5) return { error: "Please choose a rating from 1 to 5." };

  const admin = createAdminClient();

  const { data: paidOrders } = await admin
    .from("orders")
    .select("id")
    .eq("user_id", userId)
    .eq("payment_status", "paid");
  const orderIds = ((paidOrders as { id: string }[] | null) ?? []).map((o) => o.id);
  if (orderIds.length === 0) return { error: "Only verified buyers can review this item." };

  const { data: items } = await admin
    .from("order_items")
    .select("id")
    .eq("product_id", productId)
    .in("order_id", orderIds)
    .limit(1);
  if (((items as { id: string }[] | null) ?? []).length === 0) {
    return { error: "Only verified buyers can review this item." };
  }

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
