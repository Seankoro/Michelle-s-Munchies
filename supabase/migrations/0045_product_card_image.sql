-- A separate photo for menu cards.
--
-- Until now the first entry of image_paths did double duty: it was the large
-- photo at the top of the product page AND the photo on the menu card, the cart
-- line, quick-pick, the box builder and link previews. The cake tins want those
-- to differ. The product page leads with a straight-on shot labelled layer by
-- layer, which explains what is inside, while the menu shows the plain angled
-- shot, because the labels are unreadable at card size.
--
-- card_image_path holds one of the product's own image_paths. null keeps the
-- old behaviour (the first photo), so every existing product is unaffected. The
-- app ignores a value that is no longer in image_paths, so removing a photo can
-- never leave a card pointing at a deleted file.
--
-- 0030 narrowed the anon grant on products to an explicit column list and noted
-- that a new column is not granted automatically, so the storefront needs the
-- explicit grant below or every public product read fails on this column.
--
-- NOTE: apply this against the live database (Supabase dashboard SQL editor or
-- the MCP apply_migration) BEFORE deploying the code that reads it, and confirm
-- the storefront still loads afterwards.
alter table public.products add column if not exists card_image_path text;

grant select (card_image_path) on public.products to anon, authenticated;
