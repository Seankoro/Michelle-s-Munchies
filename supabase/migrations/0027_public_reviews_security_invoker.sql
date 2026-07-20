-- Fix the Supabase "SECURITY DEFINER view" advisor on public_product_reviews.
-- Switch the view to run as the querying user (security invoker). To keep the
-- storefront reviews readable after that switch, allow public SELECT on the
-- reviews rows, but withhold user_id (and internal id/updated_at) via column
-- grants so an anonymous reader can never learn who wrote a review, whether
-- through the view or by querying the table directly.

alter view public.public_product_reviews set (security_invoker = on);

-- Review content is shown publicly on the storefront, so allow reading the rows.
drop policy if exists "Public can read review content" on public.reviews;
create policy "Public can read review content"
  on public.reviews
  for select
  to anon, authenticated
  using (true);

-- Column privileges: drop the table-wide SELECT and re-grant only the six public
-- columns the view exposes. user_id, id, and updated_at stay hidden from public
-- roles. Reviews are still written by the service role, which bypasses this.
revoke select on public.reviews from anon, authenticated;
grant select (product_id, rating, body, author_name, created_at, image_paths)
  on public.reviews to anon, authenticated;
