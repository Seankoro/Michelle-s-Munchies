-- Fixes a fatal bug in 0032: create_order_with_items assigned the plain text
-- p_order->>'fulfillment_type' to orders.fulfillment_type, which is an enum.
-- Postgres does not coerce text to an enum in an INSERT, so EVERY call raised
--
--   column "fulfillment_type" is of type fulfillment_type but expression is of
--   type text
--
-- and no order could be created at all, by a customer or by the owner. The
-- plpgsql body is only planned on first execution, so creating the function
-- succeeded and the fault was invisible until an order was actually placed.
--
-- Only the one cast changes; the rest of the body is identical to 0032. Every
-- other column was already cast (uuid, jsonb, integer) or is genuinely text.
-- status and payment_status are not inserted at all, so they keep their column
-- defaults of 'received' and 'pending'.
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
    -- The cast 0032 was missing. Also validates the value: anything other than
    -- 'pickup' or 'delivery' raises instead of being stored.
    (p_order->>'fulfillment_type')::public.fulfillment_type,
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
