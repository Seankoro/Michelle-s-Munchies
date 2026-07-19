-- The open SELECT policy on reviews let anyone with the anon key read every
-- column, including user_id, linking reviewer names to auth accounts. Replace
-- it with a column-limited view so public readers only ever see review
-- content, never account identifiers. Writes are unaffected, they go through
-- the service role.
drop policy if exists "Public can read reviews" on reviews;

create or replace view public_product_reviews as
  select product_id, rating, body, author_name, created_at, image_paths
  from reviews;

grant select on public_product_reviews to anon, authenticated;
