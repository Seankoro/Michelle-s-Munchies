-- Stop the tracking link handing out the buyer's email address and phone number.
--
-- get_order_by_token is SECURITY DEFINER and anon may execute it, which is
-- deliberate. It is how a customer with no account reads their own order, and
-- the token is the whole credential. That also means it bypasses the
-- `revoke select on public.orders from anon` that migration 0035 installed, so
-- whatever this function returns is readable by anyone holding the token, using
-- only the publishable anon key.
--
-- The token is meant to be shared. It goes out by email, it gets forwarded to a
-- partner or into a group chat, and for a gift the buyer is explicitly invited
-- to pass a link on. So "holder of the link" is not the same person as "the
-- buyer", and the buyer's mobile number and email address should not travel
-- with it.
--
-- Nothing in the application reads either field from this function. Checked
-- across src/app/track, src/app/gift and src/components/track before removing
-- them, and the TrackedOrder type drops them in the same change so TypeScript
-- would fail the build if anything did.
--
-- Everything else is left exactly as migration 0041 left it, including
-- recipient_token, recipient_scheduled_at and the per-item personalisation.

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
