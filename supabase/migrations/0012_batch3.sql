-- Batch 3: owner-ops, engagement & de-AI copy. Additive / idempotent.

-- settings: 4 new feature flags (default true) + low-stock threshold
alter table settings
  add column if not exists feature_order_changes  boolean not null default true,
  add column if not exists feature_newsletter      boolean not null default true,
  add column if not exists feature_drops            boolean not null default true,
  add column if not exists feature_dietary_prefs    boolean not null default true,
  add column if not exists low_stock_threshold      int;

-- products: seasonal drop go-live time (null = available now)
alter table products add column if not exists available_from timestamptz;

-- profiles: saved dietary preferences
alter table profiles add column if not exists dietary_prefs dietary_tag[] not null default '{}';

-- orders: cap self-serve reschedules
alter table orders add column if not exists reschedule_count int not null default 0;

-- newsletter subscribers (in-house list)
create table if not exists newsletter_subscribers (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  consented_at timestamptz not null default now(),
  unsubscribe_token text not null unique,
  unsubscribed_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists newsletter_subscribers_email_unique
  on newsletter_subscribers (lower(email));

alter table newsletter_subscribers enable row level security;
-- No public policies: subscribe/unsubscribe/send all go through service-role actions.
