-- Michelle's Munchies — MVP schema (Phases 0–4).
-- Money is stored in integer cents (SGD) to avoid floating-point errors.
-- Future tables (profiles, addresses, rewards_points, reviews, wishlists,
-- promo_codes) arrive in Phase 5 and are intentionally NOT created here.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type fulfillment_type as enum ('pickup', 'delivery');

create type order_status as enum (
  'received',
  'confirmed',
  'baking',
  'ready',
  'out_for_delivery',
  'completed',
  'cancelled'
);

create type payment_status as enum ('pending', 'paid', 'refunded', 'failed');

create type allergen as enum (
  'peanuts',
  'tree_nuts',
  'gluten',
  'dairy',
  'eggs',
  'soy',
  'sesame'
);

create type dietary_tag as enum (
  'eggless',
  'vegetarian',
  'no_pork_no_lard',
  'nut_free'
);

-- ---------------------------------------------------------------------------
-- Catalog
-- ---------------------------------------------------------------------------
create table products (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  short_description text,
  long_description text,
  base_price_cents integer not null check (base_price_cents >= 0),
  category text not null,
  image_paths text[] not null default '{}',
  is_available boolean not null default true, -- sold-out toggle
  is_best_seller boolean not null default false,
  is_recommended boolean not null default false,
  allergens allergen[] not null default '{}',
  dietary_tags dietary_tag[] not null default '{}',
  storage_info text,
  serving_info text,
  lead_time_days_override integer,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index products_category_idx on products (category);
create index products_available_idx on products (is_available);

create table product_options (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products (id) on delete cascade,
  name text not null, -- e.g. "Size", "Flavour"
  required boolean not null default true,
  sort_order integer not null default 0
);

create index product_options_product_idx on product_options (product_id);

create table product_option_values (
  id uuid primary key default gen_random_uuid(),
  option_id uuid not null references product_options (id) on delete cascade,
  label text not null, -- e.g. "6 pieces"
  price_delta_cents integer not null default 0,
  is_available boolean not null default true,
  sort_order integer not null default 0
);

create index product_option_values_option_idx on product_option_values (option_id);

-- Manual "you might also like" relations (falls back to same category in app).
create table related_products (
  product_id uuid not null references products (id) on delete cascade,
  related_product_id uuid not null references products (id) on delete cascade,
  sort_order integer not null default 0,
  primary key (product_id, related_product_id)
);

-- ---------------------------------------------------------------------------
-- Orders
-- ---------------------------------------------------------------------------
create table orders (
  id uuid primary key default gen_random_uuid(),
  order_number text unique not null,
  -- Opaque token used for the no-login order-tracking page (/track/<token>).
  tracking_token text unique not null default encode(gen_random_bytes(16), 'hex'),
  status order_status not null default 'received',
  payment_status payment_status not null default 'pending',
  fulfillment_type fulfillment_type not null,
  scheduled_date date not null,
  time_window text,
  delivery_address jsonb, -- null for pickup
  customer_name text not null,
  email text not null,
  phone text not null,
  notes text,
  subtotal_cents integer not null check (subtotal_cents >= 0),
  delivery_fee_cents integer not null default 0 check (delivery_fee_cents >= 0),
  total_cents integer not null check (total_cents >= 0),
  currency text not null default 'SGD',
  stripe_payment_intent_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index orders_status_idx on orders (status);
create index orders_scheduled_date_idx on orders (scheduled_date);
create index orders_created_at_idx on orders (created_at desc);

create table order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders (id) on delete cascade,
  product_id uuid references products (id) on delete set null,
  product_name text not null, -- snapshot, survives price/name changes
  unit_price_cents integer not null check (unit_price_cents >= 0), -- base + chosen option deltas
  quantity integer not null check (quantity > 0),
  selected_options jsonb not null default '[]', -- [{ option, value, price_delta_cents }]
  line_total_cents integer not null check (line_total_cents >= 0)
);

create index order_items_order_idx on order_items (order_id);

-- ---------------------------------------------------------------------------
-- Settings (single row, id = 1)
-- ---------------------------------------------------------------------------
create table settings (
  id integer primary key default 1 check (id = 1),
  delivery_fee_cents integer not null default 800,
  free_delivery_min_cents integer, -- null = no free-delivery threshold
  min_order_cents integer not null default 0,
  lead_time_days integer not null default 2,
  daily_order_cap integer, -- null = uncapped
  blackout_dates date[] not null default '{}',
  pickup_location_public text,
  pickup_address_private text,
  time_windows text[] not null default
    '{"Morning (9am–12pm)","Afternoon (12–4pm)","Evening (4–8pm)"}',
  payment_methods_enabled text[] not null default '{paynow,card,wallet}',
  contact_email text,
  contact_phone text,
  whatsapp text,
  instagram text,
  updated_at timestamptz not null default now()
);

insert into settings (id) values (1) on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Row-Level Security
--   Catalog + settings: public read only (writes go through the service role
--   on the server, which bypasses RLS).
--   Orders + order_items: fully locked down — no anon access. The server
--   (service role) creates orders and reads them by tracking_token for the
--   no-login tracking page. This prevents one customer reading another's order.
-- ---------------------------------------------------------------------------
alter table products enable row level security;
alter table product_options enable row level security;
alter table product_option_values enable row level security;
alter table related_products enable row level security;
alter table settings enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;

create policy "Public can read products" on products for select using (true);
create policy "Public can read product options" on product_options for select using (true);
create policy "Public can read option values" on product_option_values for select using (true);
create policy "Public can read related products" on related_products for select using (true);
create policy "Public can read settings" on settings for select using (true);
-- No policies on orders / order_items => denied for anon & authenticated;
-- only the service-role server client can touch them.
