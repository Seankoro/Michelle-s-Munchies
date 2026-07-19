-- The tracking page and order emails showed Subtotal + Delivery != Total for
-- promo or points orders because the RPC never returned the discount. Expose
-- discount_cents, promo_code, and points_redeemed so both can render the
-- missing line. recipient_phone stays deliberately withheld.
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
        'line_total_cents', oi.line_total_cents
      ) order by oi.id)
      from order_items oi where oi.order_id = o.id
    ), '[]'::jsonb)
  )
  from orders o
  where o.tracking_token = p_token;
$function$;
