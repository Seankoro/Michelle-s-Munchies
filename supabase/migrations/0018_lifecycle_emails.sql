-- Idempotency stamps for the two lifecycle emails.
-- review_request_sent_at: set once when a completed order's review-request email
-- goes out, so re-marking an order completed never re-nudges the buyer.
-- winback_sent_at: set when a lapsed customer is emailed a win-back, so they are
-- nudged at most once per lapse.
alter table orders add column if not exists review_request_sent_at timestamptz;
alter table profiles add column if not exists winback_sent_at timestamptz;
