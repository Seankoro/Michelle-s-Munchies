import "server-only";
import { createPublicClient } from "@/lib/supabase/public";

export type InstagramPost = {
  id: string;
  imageUrl: string;
  linkUrl: string;
  caption: string | null;
};

/** Active curated Instagram posts for the storefront grid, in display order. */
export async function fetchActiveInstagramPosts(): Promise<InstagramPost[]> {
  const supabase = createPublicClient();
  const { data, error } = await supabase
    .from("instagram_posts")
    .select("id, image_url, link_url, caption")
    .eq("is_active", true)
    .order("sort_order", { ascending: true });
  if (error) return [];
  return (
    (data as { id: string; image_url: string; link_url: string; caption: string | null }[] | null) ??
    []
  ).map((r) => ({ id: r.id, imageUrl: r.image_url, linkUrl: r.link_url, caption: r.caption }));
}
