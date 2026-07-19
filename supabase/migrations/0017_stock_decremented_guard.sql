-- Idempotency guard for stock decrement. Marking an order paid decrements
-- tracked stock, but paid can now be reached from the Stripe webhook AND the
-- admin "Mark paid" button (PayNow), and an admin could toggle paid off and on.
-- This timestamp is set once, atomically, the first time stock is decremented,
-- so the same order never decrements twice however it becomes paid.
alter table orders add column if not exists stock_decremented_at timestamptz;
