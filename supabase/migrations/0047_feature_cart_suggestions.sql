-- Owner switch for the "Add a little something" row on the cart page, on by
-- default like the others.
--
-- NOTE: apply this to the live database BEFORE deploying the code that reads
-- settings.feature_cart_suggestions, or every settings read fails.

alter table public.settings
  add column if not exists feature_cart_suggestions boolean not null default true;

-- 0030 narrowed the anon grant to a column list, so a new column is invisible
-- to the storefront until it is granted explicitly.
grant select (feature_cart_suggestions) on public.settings to anon, authenticated;
