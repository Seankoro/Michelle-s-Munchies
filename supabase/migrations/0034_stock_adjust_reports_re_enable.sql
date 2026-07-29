-- adjust_product_stock already re-enables a product that IT auto-hid at zero
-- when a cancellation puts stock back, but it never told the caller. So a
-- product could return to sale with nobody emailing the back-in-stock waitlist
-- that was waiting for exactly that, and since is_available is true again the
-- owner has no natural action left that would fire the alert.
--
-- Adding an output column changes the return type, which create or replace
-- cannot do, so the function is dropped and recreated. Migrations run in a
-- transaction, so callers see either the old or the new definition, never a
-- missing function.
drop function if exists public.adjust_product_stock(uuid, integer);

create function public.adjust_product_stock(p_id uuid, p_delta integer)
returns table (old_count integer, new_count integer, product_name text, re_enabled boolean)
language plpgsql
as $$
declare
  v_old integer;
  v_name text;
  v_new integer;
  v_was_auto_disabled boolean;
  v_re_enabled boolean := false;
begin
  select stock_count, name, auto_disabled into v_old, v_name, v_was_auto_disabled
    from public.products
   where id = p_id
   for update;

  if not found or v_old is null then
    return; -- missing row or untracked product: no rows, caller skips
  end if;

  v_new := greatest(0, v_old + p_delta);
  -- True only when this call puts a product we hid ourselves back on sale.
  v_re_enabled := v_old <= 0 and v_new > 0 and coalesce(v_was_auto_disabled, false);

  update public.products
     set stock_count = v_new,
         -- Hide at zero. Re-show only a product this function hid itself, so a
         -- restock never republishes something Michelle took down by hand.
         is_available = case
           when v_new <= 0 then false
           when v_re_enabled then true
           else is_available
         end,
         auto_disabled = case
           when v_new <= 0 and is_available then true
           when v_re_enabled then false
           else auto_disabled
         end,
         updated_at = now()
   where id = p_id;

  old_count := v_old;
  new_count := v_new;
  product_name := v_name;
  re_enabled := v_re_enabled;
  return next;
end;
$$;

revoke all on function public.adjust_product_stock(uuid, integer) from public, anon, authenticated;
grant execute on function public.adjust_product_stock(uuid, integer) to service_role;
