-- Three fixes from the site audit, all server-side integrity work.
--
-- 1. create_order_with_items: the order row and its items used to be two
--    separate inserts from JS, so a fault between them left an orphaned,
--    itemless order that still carried a charge. The same function also owns
--    the daily and per-window capacity caps, taken under an advisory lock on
--    the scheduled date, so two concurrent checkouts can no longer both pass a
--    count-then-insert check and overbook a bake day.
--
-- 2. add_items_to_order: adding treats to an existing order wrote the item
--    rows first and the new total second. A failure in between gave the
--    customer the items for free. One function, one transaction.
--
-- 3. auto_disabled on products, maintained by adjust_product_stock: when a
--    decrement sells a product out, we remember that WE hid it, so a restock
--    from a cancelled order can safely put it back on sale. A product Michelle
--    hid by hand stays hidden.
--
-- Plus the double-opt-in columns for stock alerts and the newsletter, with
-- existing subscribers grandfathered in as confirmed.

-- ---------------------------------------------------------------------------
-- 1. Atomic order + items with capacity enforcement
-- ---------------------------------------------------------------------------
create or replace function public.create_order_with_items(
  p_order jsonb,
  p_items jsonb,
  p_daily_cap integer default null,
  p_window_cap integer default null
)
returns void
language plpgsql
as $$
declare
  v_order_id uuid := (p_order->>'id')::uuid;
  v_date date := (p_order->>'scheduled_date')::date;
  v_window text := p_order->>'time_window';
  v_count integer;
  r jsonb;
begin
  -- Serialise capacity checks per bake date. The lock is transaction-scoped,
  -- so it releases on commit or rollback automatically.
  perform pg_advisory_xact_lock(hashtext('order-capacity:' || (p_order->>'scheduled_date')));

  if p_daily_cap is not null and p_daily_cap > 0 then
    select count(*) into v_count
      from public.orders
     where scheduled_date = v_date
       and status <> 'cancelled';
    if v_count >= p_daily_cap then
      raise exception 'capacity_day_full';
    end if;
  end if;

  if p_window_cap is not null and p_window_cap > 0 and coalesce(v_window, '') <> '' then
    select count(*) into v_count
      from public.orders
     where scheduled_date = v_date
       and time_window = v_window
       and status <> 'cancelled';
    if v_count >= p_window_cap then
      raise exception 'capacity_window_full';
    end if;
  end if;

  insert into public.orders (
    id, order_number, tracking_token, recipient_token, user_id,
    fulfillment_type, scheduled_date, time_window, delivery_address,
    customer_name, email, phone, notes, is_gift, gift_message,
    recipient_name, recipient_phone, subtotal_cents, delivery_fee_cents,
    discount_cents, points_redeemed, promo_code, note_answers, total_cents,
    currency
  ) values (
    v_order_id,
    p_order->>'order_number',
    p_order->>'tracking_token',
    p_order->>'recipient_token',
    (p_order->>'user_id')::uuid,
    p_order->>'fulfillment_type',
    v_date,
    v_window,
    nullif(p_order->'delivery_address', 'null'::jsonb),
    p_order->>'customer_name',
    p_order->>'email',
    p_order->>'phone',
    p_order->>'notes',
    coalesce((p_order->>'is_gift')::boolean, false),
    p_order->>'gift_message',
    p_order->>'recipient_name',
    p_order->>'recipient_phone',
    (p_order->>'subtotal_cents')::integer,
    (p_order->>'delivery_fee_cents')::integer,
    coalesce((p_order->>'discount_cents')::integer, 0),
    coalesce((p_order->>'points_redeemed')::integer, 0),
    p_order->>'promo_code',
    coalesce(p_order->'note_answers', '[]'::jsonb),
    (p_order->>'total_cents')::integer,
    coalesce(p_order->>'currency', 'SGD')
  );

  for r in select value from jsonb_array_elements(p_items)
  loop
    insert into public.order_items (
      order_id, product_id, product_name, unit_price_cents, quantity,
      selected_options, personalisation, line_total_cents
    ) values (
      v_order_id,
      (r->>'product_id')::uuid,
      r->>'product_name',
      (r->>'unit_price_cents')::integer,
      (r->>'quantity')::integer,
      coalesce(r->'selected_options', '[]'::jsonb),
      nullif(r->'personalisation', 'null'::jsonb),
      (r->>'line_total_cents')::integer
    );
  end loop;
end;
$$;

revoke all on function public.create_order_with_items(jsonb, jsonb, integer, integer)
  from public, anon, authenticated;
grant execute on function public.create_order_with_items(jsonb, jsonb, integer, integer)
  to service_role;

-- ---------------------------------------------------------------------------
-- 2. Atomic add-items for the order-changes flow
-- ---------------------------------------------------------------------------
create or replace function public.add_items_to_order(
  p_order_id uuid,
  p_items jsonb,
  p_added_cents integer
)
returns void
language plpgsql
as $$
declare
  r jsonb;
begin
  for r in select value from jsonb_array_elements(p_items)
  loop
    insert into public.order_items (
      order_id, product_id, product_name, unit_price_cents, quantity,
      selected_options, line_total_cents
    ) values (
      p_order_id,
      (r->>'product_id')::uuid,
      r->>'product_name',
      (r->>'unit_price_cents')::integer,
      (r->>'quantity')::integer,
      coalesce(r->'selected_options', '[]'::jsonb),
      (r->>'line_total_cents')::integer
    );
  end loop;

  update public.orders
     set subtotal_cents = subtotal_cents + p_added_cents,
         total_cents = total_cents + p_added_cents,
         updated_at = now()
   where id = p_order_id;

  if not found then
    raise exception 'order_not_found';
  end if;
end;
$$;

revoke all on function public.add_items_to_order(uuid, jsonb, integer)
  from public, anon, authenticated;
grant execute on function public.add_items_to_order(uuid, jsonb, integer)
  to service_role;

-- ---------------------------------------------------------------------------
-- 3. Remember when a sell-out auto-hid a product, so restock can re-enable it
-- ---------------------------------------------------------------------------
alter table public.products
  add column if not exists auto_disabled boolean not null default false;

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
         -- Hide at zero. Re-show only a product this function hid itself, so a
         -- restock never republishes something Michelle took down by hand.
         is_available = case
           when v_new <= 0 then false
           when v_old <= 0 and v_new > 0 and auto_disabled then true
           else is_available
         end,
         auto_disabled = case
           when v_new <= 0 and is_available then true
           when v_old <= 0 and v_new > 0 and auto_disabled then false
           else auto_disabled
         end,
         updated_at = now()
   where id = p_id;

  old_count := v_old;
  new_count := v_new;
  product_name := v_name;
  return next;
end;
$$;

revoke all on function public.adjust_product_stock(uuid, integer) from public, anon, authenticated;
grant execute on function public.adjust_product_stock(uuid, integer) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Double opt-in for stock alerts and the newsletter
-- ---------------------------------------------------------------------------
alter table public.stock_notifications
  add column if not exists confirm_token text,
  add column if not exists confirmed_at timestamptz;

-- Everyone already on the list subscribed before double opt-in existed, so
-- they are grandfathered in as confirmed rather than dropped.
update public.stock_notifications set confirmed_at = now() where confirmed_at is null;

create unique index if not exists stock_notifications_confirm_token_key
  on public.stock_notifications (confirm_token)
  where confirm_token is not null;

alter table public.newsletter_subscribers
  add column if not exists confirm_token text,
  add column if not exists confirmed_at timestamptz;

update public.newsletter_subscribers set confirmed_at = now() where confirmed_at is null;

create unique index if not exists newsletter_subscribers_confirm_token_key
  on public.newsletter_subscribers (confirm_token)
  where confirm_token is not null;
