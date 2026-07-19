-- A gift buyer can let the recipient fill in their own delivery address and time
-- window, via a separate token so the recipient never sees the price or the
-- buyer's contact details. recipient_scheduled_at stamps when they confirmed.
alter table orders add column if not exists recipient_token text unique;
alter table orders add column if not exists recipient_scheduled_at timestamptz;

-- Extend the buyer-facing tracking RPC so their track page can offer the share
-- link and reflect whether the recipient has confirmed yet.
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
    'deposit_cents', o.deposit_cents,
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

-- Recipient-facing lookup. Deliberately omits price, items, and the buyer's
-- email and phone, so a shared link only reveals what the recipient needs to
-- schedule their own delivery. Only resolves for a gift order.
create or replace function public.get_gift_by_token(p_token text)
returns jsonb
language sql
security definer
set search_path to 'public'
as $function$
  select jsonb_build_object(
    'order_number', o.order_number,
    'sender_name', o.customer_name,
    'recipient_name', o.recipient_name,
    'gift_message', o.gift_message,
    'fulfillment_type', o.fulfillment_type,
    'scheduled_date', o.scheduled_date,
    'time_window', o.time_window,
    'delivery_address', o.delivery_address,
    'status', o.status,
    'recipient_scheduled_at', o.recipient_scheduled_at
  )
  from orders o
  where o.recipient_token = p_token and o.is_gift = true;
$function$;
