-- Put the "is this order still changeable" rule on the write itself.
--
-- addItemsToOrderAction reads status and payment_status, then does several more
-- round trips, fetching settings, fetching products, resolving the cart lines,
-- before calling add_items_to_order. The function then updated the order with no
-- predicate at all, so anything that changed in that window was simply missed.
-- If Michelle marks the order paid, or a Stripe webhook does, while the customer
-- is finishing their add, the items land on a paid order and the total goes up
-- with no more money behind it. The customer gets the difference for free.
--
-- The read stays where it is so the customer still gets a clear message. This is
-- the backstop that makes the answer true at the moment of the write.
--
-- The two functions get DIFFERENT predicates on purpose, each mirroring the JS
-- guard of its own caller. add_items_to_order is the customer's path and follows
-- EARLY_STATUSES in src/lib/order.ts, received and confirmed. The remove path is
-- the owner's and follows statusRequiresPayment, which also allows 'cancelled'
-- so she can still correct a cancelled order. Keep each in step with its caller.

create or replace function public.add_items_to_order(p_order_id uuid, p_items jsonb, p_added_cents integer)
 returns void
 language plpgsql
 set search_path to 'public'
as $function$
declare
  r jsonb;
begin
  -- Guard first. The whole function is one transaction, so raising here rolls
  -- back nothing that matters, but doing it before the inserts keeps the intent
  -- obvious to whoever reads this next.
  perform 1
    from public.orders
   where id = p_order_id
     and status in ('received', 'confirmed')
     and payment_status in ('pending', 'failed');
  if not found then
    -- Told apart from a missing row on purpose, so the caller can say which
    -- happened rather than guessing.
    if not exists (select 1 from public.orders where id = p_order_id) then
      raise exception 'order_not_found';
    end if;
    raise exception 'order_not_changeable';
  end if;

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
$function$;

-- The same window exists on the way out. Removing lines from an order that has
-- been paid drops the total below what was actually taken, which is the same
-- problem pointing the other way.
create or replace function public.remove_items_from_order(p_order_id uuid, p_item_ids uuid[])
 returns integer
 language plpgsql
 set search_path to 'public'
as $function$
declare
  v_removed integer;
begin
  -- Wider than the add path on purpose. This one is the owner's, and its guard
  -- in admin-db.ts is statusRequiresPayment, which permits 'cancelled' so she
  -- can still correct what a cancelled order says it contained.
  perform 1
    from public.orders
   where id = p_order_id
     and status not in ('baking', 'ready', 'out_for_delivery', 'completed')
     and payment_status not in ('paid', 'refunded');
  if not found then
    if not exists (select 1 from public.orders where id = p_order_id) then
      raise exception 'order_not_found';
    end if;
    raise exception 'order_not_changeable';
  end if;

  select coalesce(sum(line_total_cents), 0) into v_removed
    from public.order_items
   where order_id = p_order_id
     and id = any (p_item_ids);

  delete from public.order_items
   where order_id = p_order_id
     and id = any (p_item_ids);

  update public.orders
     set subtotal_cents = greatest(0, subtotal_cents - v_removed),
         total_cents = greatest(0, total_cents - v_removed),
         updated_at = now()
   where id = p_order_id;

  if not found then
    raise exception 'order_not_found';
  end if;

  return v_removed;
end;
$function$;

-- Both also gain a fixed search_path, which the database linter flagged. Without
-- it the function resolves unqualified names against whatever search_path the
-- caller happens to have set.
