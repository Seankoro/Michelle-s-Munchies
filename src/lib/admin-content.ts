import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export type AdminInstagramPost = {
  id: string;
  imageUrl: string;
  linkUrl: string;
  caption: string | null;
  isActive: boolean;
  sortOrder: number;
};
export type NewInstagramPost = Omit<AdminInstagramPost, "id">;

export async function fetchAdminInstagramPosts(): Promise<AdminInstagramPost[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("instagram_posts")
    .select("id, image_url, link_url, caption, is_active, sort_order")
    .order("sort_order", { ascending: true });
  if (error) throw new Error(`Failed to load Instagram posts: ${error.message}`);
  return (
    (data as
      | {
          id: string;
          image_url: string;
          link_url: string;
          caption: string | null;
          is_active: boolean;
          sort_order: number;
        }[]
      | null) ?? []
  ).map((r) => ({
    id: r.id,
    imageUrl: r.image_url,
    linkUrl: r.link_url,
    caption: r.caption,
    isActive: r.is_active,
    sortOrder: r.sort_order,
  }));
}

function toColumns(input: NewInstagramPost) {
  return {
    image_url: input.imageUrl,
    link_url: input.linkUrl,
    caption: input.caption,
    is_active: input.isActive,
    sort_order: input.sortOrder,
  };
}

export async function createInstagramPost(input: NewInstagramPost): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase.from("instagram_posts").insert(toColumns(input));
  if (error) throw new Error(`Failed to create post: ${error.message}`);
}

export async function updateInstagramPost(id: string, input: NewInstagramPost): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase.from("instagram_posts").update(toColumns(input)).eq("id", id);
  if (error) throw new Error(`Failed to update post: ${error.message}`);
}

export async function deleteInstagramPost(id: string): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase.from("instagram_posts").delete().eq("id", id);
  if (error) throw new Error(`Failed to delete post: ${error.message}`);
}
