-- Remove deposits entirely.
--
-- Deposits were never wanted. No customer could ever choose one, checkout never
-- wrote the column, and the only way to create one was Michelle typing into a
-- box on the order. Nothing ever did. Across the whole database not one order
-- has ever carried a deposit, and it cost 175 references across 11 files,
-- including a branch sitting inside the cancel and refund path where the two
-- worst bugs of this audit were found.
--
-- The application no longer reads or writes either column. Deploy that first,
-- then run this, because get_order_by_token is replaced here and the old code
-- still expects deposit_cents in its result.

-- The tracking page reads this function, and dropping a column the function
-- selects would take the function down with it. This is the definition that is
-- live right now with the deposit_cents line removed and nothing else touched,
-- so recipient_token, recipient_scheduled_at and the per-item personalisation
-- all survive.
create or replace function public.get_order_by_token(p_token text)
 returns jsonb
 language sql
 security definer
 set search_path to 'public'
as $function$
  select jsonb_build_object(
    'order_number', o.order_number,
    'status', o.status,
    'payment_status', o.payment_status,
    'fulfillment_type', o.fulfillment_type,
    'scheduled_date', o.scheduled_date,
    'time_window', o.time_window,
    'delivery_address', o.delivery_address,
    'customer_name', o.customer_name,
    'email', o.email,
    'phone', o.phone,
    'notes', o.notes,
    'is_gift', o.is_gift,
    'gift_message', o.gift_message,
    'recipient_name', o.recipient_name,
    'recipient_token', o.recipient_token,
    'recipient_scheduled_at', o.recipient_scheduled_at,
    'subtotal_cents', o.subtotal_cents,
    'delivery_fee_cents', o.delivery_fee_cents,
    'discount_cents', o.discount_cents,
    'promo_code', o.promo_code,
    'points_redeemed', o.points_redeemed,
    'total_cents', o.total_cents,
    'created_at', o.created_at,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'product_name', oi.product_name,
        'unit_price_cents', oi.unit_price_cents,
        'quantity', oi.quantity,
        'selected_options', oi.selected_options,
        'personalisation', oi.personalisation,
        'line_total_cents', oi.line_total_cents
      ) order by oi.id)
      from order_items oi where oi.order_id = o.id
    ), '[]'::jsonb)
  )
  from orders o
  where o.tracking_token = p_token;
$function$;

-- Refuse to run if any order actually carries a deposit. Nothing does today,
-- and dropping a column with money recorded in it would destroy the only record
-- of that money.
do $$
declare
  n integer;
begin
  select count(*) into n
  from public.orders
  where coalesce(deposit_cents, 0) > 0
     or coalesce(deposit_outstanding_cents, 0) > 0;
  if n > 0 then
    raise exception
      'Refusing to drop the deposit columns, % order(s) still carry a deposit', n;
  end if;
end $$;

alter table public.orders drop column if exists deposit_cents;
alter table public.orders drop column if exists deposit_outstanding_cents;
