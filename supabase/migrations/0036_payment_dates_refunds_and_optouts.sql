-- Schema for the logic-gap audit fixes the owner chose.
--
-- 1. orders.paid_at. Nothing recorded WHEN money actually arrived, only that it
--    had. Since the normal path is a PayNow transfer that Michelle marks by hand
--    days after the order, every figure in Insights was attributed to the order
--    date instead of the payment date, so no month could be tied to her bank
--    statement. Null on unpaid orders, stamped on the pending-to-paid transition.
--
-- 2. orders.deposit_outstanding_cents. A deposit is real money in her bank, but
--    cancelling an order left it with no record of its fate. On cancel she now
--    says whether it went back or is still owed, and an owed amount stays
--    visible until she clears it. Null means nothing is owed.
--
-- 3. order_refunds. Money could only be returned by cancelling the whole order,
--    so a goodwill refund, a partial refund, or a refund she issued directly in
--    Stripe was invisible and revenue was overstated for good. Each row is one
--    amount returned, with a reason and a date, and reporting subtracts them.
--    Kept as its own table rather than a column so partial refunds can happen
--    more than once on the same order.
--
-- 4. email_opt_outs. Four cron-driven marketing emails (win-back, occasion
--    reminder, birthday, abandoned cart) had no opt-out at all, and the one
--    unsubscribe that existed governed only the newsletter. This is an
--    address-level suppression list every marketing send now checks, which is
--    also what Singapore's Spam Control Act expects of commercial email.
--
-- 5. remove_items_from_order. Orders could only ever grow. A short bake or a
--    substitution left the order describing food that was never delivered, and
--    a customer could post a verified review of a treat they never tasted. This
--    mirrors add_items_to_order: the item rows and the totals move together in
--    one transaction, and the amount removed is computed from the rows
--    themselves rather than trusted from the caller.
--
-- All additive. Safe to apply before deploying, since nothing live reads these.

alter table public.orders add column if not exists paid_at timestamptz;
alter table public.orders add column if not exists deposit_outstanding_cents integer;

create table if not exists public.order_refunds (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  amount_cents integer not null check (amount_cents > 0),
  reason text,
  -- Whether the money went back through Stripe or by a manual bank transfer,
  -- so the books can say which and Stripe's own records can be matched.
  via text not null default 'manual' check (via in ('manual', 'stripe')),
  created_at timestamptz not null default now()
);

create index if not exists order_refunds_order_id_idx on public.order_refunds (order_id);

create table if not exists public.email_opt_outs (
  email text primary key,
  -- One-click token carried in the footer of every marketing email.
  token text not null unique,
  created_at timestamptz not null default now()
);

-- Both tables are server-only: RLS on with no policies, and no grants to the
-- public roles, so only the service-role client the server uses can reach them.
alter table public.order_refunds enable row level security;
alter table public.email_opt_outs enable row level security;
revoke all on table public.order_refunds from anon, authenticated;
revoke all on table public.email_opt_outs from anon, authenticated;

-- Atomic item removal, the mirror of add_items_to_order.
create or replace function public.remove_items_from_order(
  p_order_id uuid,
  p_item_ids uuid[]
)
returns integer
language plpgsql
as $$
declare
  v_removed integer;
begin
  -- Sum from the rows themselves, so a caller cannot understate what it is
  -- taking off the order and leave the customer credited the wrong amount.
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
$$;

revoke all on function public.remove_items_from_order(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.remove_items_from_order(uuid, uuid[]) to service_role;
