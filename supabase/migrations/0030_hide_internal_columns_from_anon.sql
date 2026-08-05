-- Narrow the public (anon-readable) grants on products and settings so internal
-- columns stop leaking through the REST API with the public anon key.
--
-- Two columns are business-private but sat on tables whose select policy is
-- `using (true)`, and the anon role held a table-wide SELECT that covered every
-- column:
--   products.cost_cents          -- Michelle's ingredient/packaging cost (margin)
--   settings.pickup_address_private -- the owner's private pickup address
--
-- The storefront never needs either: product reads now select an explicit column
-- list without cost_cents, and the client settings read already selects only
-- public columns. Admin reads both through the service role, which bypasses these
-- grants. This mirrors 0027 (reviews) and 0029 (kitchen coords).
--
-- The re-grant lists every current column EXCEPT the private one, computed from
-- the live catalog so a future column is covered without editing this file. A
-- newly added column is NOT auto-granted to anon, which is the safe default: grant
-- it explicitly in the migration that adds it if the storefront needs it.
--
-- KNOWN AND ACCEPTED: the re-grant covers products.ingredients, which the
-- storefront genuinely needs, because the product page lists ingredient NAMES for
-- allergen transparency. The column is jsonb and also holds each line's amount and
-- unit, and those are never rendered anywhere, so applying this leaves the recipe
-- QUANTITIES readable through the REST API with the public key. Low harm for a
-- home bakery and better than breaking the ingredient list, but if the quantities
-- ever matter, the fix is to split them into their own column (or read products
-- through the service role) rather than to drop ingredients from this list.
--
-- NOTE: apply this against the live database (Supabase dashboard SQL editor or the
-- MCP apply_migration) and confirm the storefront still loads afterwards.

do $$
declare
  cols text;
begin
  -- products: re-grant every column except the admin-only cost.
  select string_agg(quote_ident(column_name), ', ')
    into cols
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'products'
     and column_name <> 'cost_cents';
  execute 'revoke select on public.products from anon, authenticated';
  execute 'grant select (' || cols || ') on public.products to anon, authenticated';

  -- settings: re-grant every column except the private pickup address.
  select string_agg(quote_ident(column_name), ', ')
    into cols
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'settings'
     and column_name <> 'pickup_address_private';
  execute 'revoke select on public.settings from anon, authenticated';
  execute 'grant select (' || cols || ') on public.settings to anon, authenticated';
end $$;
