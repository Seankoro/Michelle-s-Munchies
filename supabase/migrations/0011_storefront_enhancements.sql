-- Storefront enhancements: feature flags, config columns, and new tables.
-- All additive / idempotent. Applied after 0010 (enum values committed).

-- settings: 11 feature flags (default true) + config columns
alter table settings
  add column if not exists feature_build_a_box      boolean not null default true,
  add column if not exists feature_bundles          boolean not null default true,
  add column if not exists feature_spend_gift       boolean not null default true,
  add column if not exists feature_back_in_stock    boolean not null default true,
  add column if not exists feature_photo_reviews    boolean not null default true,
  add column if not exists feature_cart_sharing     boolean not null default true,
  add column if not exists feature_wishlist_sharing boolean not null default true,
  add column if not exists feature_instagram_feed   boolean not null default true,
  add column if not exists feature_birthday_rewards boolean not null default true,
  add column if not exists feature_abandoned_cart   boolean not null default true,
  add column if not exists feature_structured_notes boolean not null default true,
  add column if not exists per_window_cap           int,
  add column if not exists daily_cutoff_time         time,
  add column if not exists free_gift_threshold_cents int,
  add column if not exists free_gift_product_id      uuid references products(id) on delete set null,
  add column if not exists birthday_reward_points    int  not null default 0,
  add column if not exists abandoned_after_hours     int  not null default 4,
  add column if not exists note_prompts              jsonb not null default '[]'::jsonb;

-- products: optional stock tracking (null = untracked)
alter table products add column if not exists stock_count int;

-- profiles: birthday + idempotency guard
alter table profiles
  add column if not exists birthday date,
  add column if not exists birthday_rewarded_year int;

-- orders: structured note answers (free-text notes column unchanged)
alter table orders add column if not exists note_answers jsonb not null default '[]'::jsonb;

-- reviews: photo URLs
alter table reviews add column if not exists image_paths text[] not null default '{}';

-- bundles
create table if not exists bundles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description text,
  price_cents int not null check (price_cents >= 0),
  image_path text,
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create table if not exists bundle_items (
  id uuid primary key default gen_random_uuid(),
  bundle_id uuid not null references bundles(id) on delete cascade,
  product_id uuid not null references products(id) on delete restrict,
  quantity int not null default 1 check (quantity > 0)
);

-- build-a-box templates
create table if not exists box_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  item_count int not null check (item_count > 0),
  price_cents int not null check (price_cents >= 0),
  eligible_category text,
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create table if not exists box_template_items (
  id uuid primary key default gen_random_uuid(),
  box_template_id uuid not null references box_templates(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade
);

-- back-in-stock subscriptions
create table if not exists stock_notifications (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  email text not null,
  user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  notified_at timestamptz
);
create unique index if not exists stock_notifications_unique
  on stock_notifications (product_id, lower(email)) where notified_at is null;

-- wishlist share tokens
create table if not exists wishlist_shares (
  token text primary key,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- instagram posts (manual curation)
create table if not exists instagram_posts (
  id uuid primary key default gen_random_uuid(),
  image_url text not null,
  link_url text not null,
  caption text,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- abandoned-cart intents
create table if not exists checkout_intents (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  items jsonb not null,
  subtotal_cents int not null default 0,
  created_at timestamptz not null default now(),
  reminded_at timestamptz,
  converted_order_id uuid references orders(id) on delete set null
);
create index if not exists checkout_intents_pending
  on checkout_intents (created_at) where reminded_at is null and converted_order_id is null;

-- RLS on all new tables
alter table bundles enable row level security;
alter table bundle_items enable row level security;
alter table box_templates enable row level security;
alter table box_template_items enable row level security;
alter table stock_notifications enable row level security;
alter table wishlist_shares enable row level security;
alter table instagram_posts enable row level security;
alter table checkout_intents enable row level security;

-- Public read only for active merchandising/content; everything else service-role only.
drop policy if exists "public reads active bundles" on bundles;
create policy "public reads active bundles" on bundles for select using (is_active);

drop policy if exists "public reads bundle items" on bundle_items;
create policy "public reads bundle items" on bundle_items for select using (
  exists (select 1 from bundles b where b.id = bundle_id and b.is_active));

drop policy if exists "public reads active box templates" on box_templates;
create policy "public reads active box templates" on box_templates for select using (is_active);

drop policy if exists "public reads box items" on box_template_items;
create policy "public reads box items" on box_template_items for select using (
  exists (select 1 from box_templates t where t.id = box_template_id and t.is_active));

drop policy if exists "public reads active instagram" on instagram_posts;
create policy "public reads active instagram" on instagram_posts for select using (is_active);

-- wishlist_shares, stock_notifications, checkout_intents: NO public policies.
-- They are only read/written via the service-role client (share resolution,
-- subscriptions, intents), so public read would needlessly expose tokens/data.
