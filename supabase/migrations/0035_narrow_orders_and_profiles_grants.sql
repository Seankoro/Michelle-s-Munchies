-- Two column-level leaks the audit found. Row-level security decides which ROWS
-- a signed-in customer can see, never which COLUMNS, so every column of their
-- own order and their own profile is reachable straight from the public REST
-- API with an ordinary session. Same fix shape as 0027 and 0030: revoke the
-- table-wide grant, then re-grant only the columns the customer app actually
-- uses.
--
-- 1. orders.owner_note is Michelle's private note ABOUT the customer, and it was
--    readable by that customer. So were recipient_token (which would let the
--    buyer act as the gift recipient), stripe_payment_intent_id, and the
--    internal stock_decremented_at / review_request_sent_at bookkeeping.
--
-- 2. profiles lets the customer UPDATE any column, including birthday_rewarded_year
--    and winback_sent_at. Those are server-owned replay guards: resetting the
--    birthday one re-farms birthday reward points every time it is cleared.
--
-- SEQUENCING, THE HARD-WON RULE: apply this only AFTER the branch that contains
-- it is deployed. Narrowing grants while older code is still live breaks the
-- site, exactly as an early application of 0030 did. Every server-side read
-- uses the service-role client, which bypasses column grants, so only the two
-- customer-session queries below matter, and both are in the deployed branch.

-- --------------------------------------------------------------------------
-- orders: the only customer-session read is src/app/account/page.tsx, which
-- selects order_number, tracking_token, status, payment_status, total_cents,
-- scheduled_date, created_at. user_id is required too, because the RLS policy
-- and the query both filter on it. anon needs nothing at all: guest order
-- tracking goes through the get_order_by_token SECURITY DEFINER function.
-- --------------------------------------------------------------------------
revoke select on public.orders from anon, authenticated;

grant select (
  user_id,
  order_number,
  tracking_token,
  status,
  payment_status,
  total_cents,
  scheduled_date,
  created_at
) on public.orders to authenticated;

-- --------------------------------------------------------------------------
-- profiles: the only customer-session write is updateProfile in
-- src/app/account/actions.ts, which sets full_name, phone, birthday,
-- dietary_prefs, and updated_at. Everything else on this table is server-owned:
-- referral_code, referred_by, birthday_rewarded_year, winback_sent_at.
-- SELECT is left as it is; the customer reading their own profile is fine.
-- --------------------------------------------------------------------------
revoke update on public.profiles from anon, authenticated;

grant update (
  full_name,
  phone,
  birthday,
  dietary_prefs,
  updated_at
) on public.profiles to authenticated;
