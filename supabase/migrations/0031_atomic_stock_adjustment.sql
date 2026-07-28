-- Atomic stock adjustment so two orders paid concurrently for the same tracked
-- product cannot both read the same stock_count and clobber each other's write
-- (the previous JS read-modify-write in decrementStockForOrder / restockOrder
-- could oversell and leave is_available wrong). A negative delta decrements (the
-- paid transition), a positive delta restocks (a cancel). The row is locked with
-- FOR UPDATE so concurrent calls on the same product serialise.
--
-- Returns the old and new counts plus the name so the caller can still detect a
-- low-stock threshold crossing. Untracked products (null stock_count) return no
-- rows, so the caller skips them. Never re-enables a sold-out product on restock.
--
-- Service-role only: the admin server client calls this; anon/authenticated must
-- not be able to move inventory.
create or replace function public.adjust_product_stock(p_id uuid, p_delta integer)
returns table (old_count integer, new_count integer, product_name text)
language plpgsql
as $$
declare
  v_old integer;
  v_name text;
  v_new integer;
begin
  select stock_count, name into v_old, v_name
    from public.products
   where id = p_id
   for update;

  if not found or v_old is null then
    return; -- missing row or untracked product: no rows, caller skips
  end if;

  v_new := greatest(0, v_old + p_delta);
  update public.products
     set stock_count = v_new,
         is_available = case when v_new <= 0 then false else is_available end,
         updated_at = now()
   where id = p_id;

  old_count := v_old;
  new_count := v_new;
  product_name := v_name;
  return next;
end;
$$;

-- Postgres grants EXECUTE on a new function to PUBLIC by default, so revoking
-- from anon/authenticated alone leaves it callable via the PUBLIC grant. Revoke
-- from PUBLIC and grant only the service role that the admin client uses, so no
-- anonymous caller can move inventory through this RPC.
revoke all on function public.adjust_product_stock(uuid, integer) from public, anon, authenticated;
grant execute on function public.adjust_product_stock(uuid, integer) to service_role;
