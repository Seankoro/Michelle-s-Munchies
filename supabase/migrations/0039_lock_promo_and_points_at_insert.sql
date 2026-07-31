-- Close the last count-then-insert races on the money path.
--
-- 0032 moved the daily and per-window capacity caps inside this function and
-- took an advisory lock, because counting rows in the action and inserting
-- afterwards let two simultaneous checkouts both pass. The promo caps and the
-- loyalty points balance were left behind in exactly that shape: validatePromo
-- counts the code's existing orders, the points block sums the ledger and
-- subtracts what unpaid orders hold, and only then does the insert happen, with
-- no lock in between.
--
-- So N checkouts fired at once all read the same state before any of them
-- writes: a single-use promo is redeemed N times, and the same points balance
-- becomes a discount on all N orders, driving the ledger negative when they are
-- marked paid. Both are real money off real food.
--
-- The caps are re-asserted here, inside the same transaction as the insert,
-- under advisory locks keyed on the promo code and on the customer. Locks are
-- always taken in the same order (date, then promo, then customer) so two
-- concurrent inserts can never deadlock against each other.
--
-- The caps themselves still come from the action, which owns reading settings
-- and the promo row; this function only enforces what it is told, the same way
-- p_daily_cap and p_window_cap already work.
drop function if exists public.create_order_with_items(jsonb, jsonb, integer, integer);

create function public.create_order_with_items(
  p_order jsonb,
  p_items jsonb,
  p_daily_cap integer default null,
  p_window_cap integer default null,
  p_promo_max_redemptions integer default null,
  p_promo_per_customer_limit integer default null
)
returns void
language plpgsql
as $$
declare
  v_order_id uuid := (p_order->>'id')::uuid;
  v_date date := (p_order->>'scheduled_date')::date;
  v_window text := p_order->>'time_window';
  v_user_id uuid := (p_order->>'user_id')::uuid;
  v_email text := lower(coalesce(p_order->>'email', ''));
  v_promo text := nullif(coalesce(p_order->>'promo_code', ''), '');
  v_points integer := coalesce((p_order->>'points_redeemed')::integer, 0);
  v_count integer;
  v_balance integer;
  v_held integer;
  r jsonb;
begin
  -- 1. Capacity, per bake date.
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

  -- 2. Promo caps, per code. Only locks when the order actually carries a code.
  if v_promo is not null then
    perform pg_advisory_xact_lock(hashtext('promo:' || v_promo));

    if p_promo_max_redemptions is not null and p_promo_max_redemptions > 0 then
      select count(*) into v_count
        from public.orders
       where promo_code = v_promo
         and status <> 'cancelled';
      if v_count >= p_promo_max_redemptions then
        raise exception 'promo_cap_reached';
      end if;
    end if;

    if p_promo_per_customer_limit is not null and p_promo_per_customer_limit > 0 then
      -- Matches the action's own rule: one person is their account OR their
      -- email address, so a guest and a signed-in order by the same buyer count
      -- once. An order matching both is still one row, so no double counting.
      select count(*) into v_count
        from public.orders
       where promo_code = v_promo
         and status <> 'cancelled'
         and (
           (v_user_id is not null and user_id = v_user_id)
           or (v_email <> '' and lower(email) = v_email)
         );
      if v_count >= p_promo_per_customer_limit then
        raise exception 'promo_customer_cap';
      end if;
    end if;
  end if;

  -- 3. Loyalty points, per customer. Points are only debited from the ledger
  -- when an order is marked paid, so what is spendable is the ledger balance
  -- minus what this customer's own unpaid orders have already promised away.
  if v_points > 0 and v_user_id is not null then
    perform pg_advisory_xact_lock(hashtext('points:' || v_user_id::text));

    select coalesce(sum(delta), 0) into v_balance
      from public.points_ledger
     where user_id = v_user_id;

    select coalesce(sum(points_redeemed), 0) into v_held
      from public.orders
     where user_id = v_user_id
       and payment_status in ('pending', 'failed')
       and status <> 'cancelled';

    if v_points > greatest(0, v_balance - v_held) then
      raise exception 'points_unavailable';
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
    v_user_id,
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
    v_points,
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

revoke all on function public.create_order_with_items(jsonb, jsonb, integer, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.create_order_with_items(jsonb, jsonb, integer, integer, integer, integer)
  to service_role;
