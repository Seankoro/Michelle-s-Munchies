-- Coming soon as its own product status.
--
-- Until now a product was "upcoming" only when it had a future available_from,
-- so there was no way to show a treat on the menu as a teaser without also
-- picking a launch time, and the launch time could not be kept for later.
--
-- coming_soon is the switch. available_from becomes the optional launch time
-- that only counts while coming_soon is on:
--   coming_soon and no date      -> teaser card, no product page, not orderable
--   coming_soon and future date  -> "Coming 12 Dec", countdown page, waitlist
--   coming_soon and past date    -> on sale; it launched by itself
--   coming_soon off              -> the date is kept but ignored
--
-- NOTE: apply this to the live database BEFORE deploying the code that reads
-- products.coming_soon, or every product read fails. Apply 0045 first.

alter table public.products
  add column if not exists coming_soon boolean not null default false;

-- 0030 narrowed the anon grant to a column list, so a new column is invisible
-- to the storefront until it is granted explicitly.
grant select (coming_soon) on public.products to anon, authenticated;

-- Scheduled drops that have not launched yet keep behaving exactly as before.
update public.products
   set coming_soon = true
 where available_from is not null
   and available_from > now();
