-- ============================================================================
-- Michelle's Munchies - baseline schema for the `public` schema
-- ============================================================================
--
-- WHAT THIS FILE IS
--   A complete, from-scratch definition of the `public` schema as it actually
--   existed in the live Supabase project (ref ddwesutmtlytbcluqcuc) on
--   2026-07-30. It was reconstructed by introspecting the live database with
--   pg_catalog / information_schema, using pg_get_constraintdef,
--   pg_get_indexdef, pg_get_expr, pg_get_viewdef and pg_get_functiondef so the
--   definitions are the server's own text rather than hand-assembled SQL.
--
--   Independently re-audited against the same live database on 2026-07-30 by a
--   second pass that diffed every category separately: columns, enum label
--   order, all four constraint kinds, indexes and their partial WHERE clauses,
--   function bodies, triggers, RLS flags, policy expressions, table and column
--   level grants, and function EXECUTE grants. Four gaps were found and are
--   fixed in place: the missing `extensions` USAGE grant (section 1), the
--   unqualified gen_random_bytes in orders.tracking_token (section 3), the
--   missing ALTER DEFAULT PRIVILEGES (end of section 10), and a wrong comment
--   claiming the tables were listed alphabetically.
--
-- WHY IT EXISTS
--   Sixteen migrations were applied to the live database that exist nowhere in
--   supabase/migrations, so the numbered migration files can no longer rebuild
--   the schema. This file can. It is the new starting point.
--
-- HOW TO USE IT
--   This is a BASELINE, not a migration. Run it against an EMPTY database (a
--   fresh branch, a local `supabase start`, a preview project) to reproduce the
--   live schema. Do NOT apply it to the live database, which already has every
--   object below.
--
--   The numbered migrations 0001 and 0010-0035 that precede this file describe
--   history only. Once this baseline is trusted, new work should be numbered
--   after it.
--
-- WHAT IT DOES NOT CONTAIN
--   No data, only schema. No Supabase-managed schemas (auth, storage, realtime,
--   vault, extensions). Where a public object depends on one of those, the
--   dependency is called out in a comment marked EXTERNAL DEPENDENCY.
--
-- READ THE GRANTS SECTION (section 10) BEFORE TRUSTING THE SECURITY MODEL.
--   The live column-level grants do not match what the repo's migrations
--   intended. That is reproduced faithfully here and explained in place.
--
-- ============================================================================

-- `extensions` is on the search path as a convenience. Nothing in this file
-- relies on it: every pgcrypto call below is schema qualified so the file works
-- even when a tool runs it statement by statement and this SET is lost.
set search_path = public, extensions;


-- ============================================================================
-- 1. EXTENSIONS
-- ============================================================================
--
-- pgcrypto is the only extension the public schema genuinely depends on:
-- orders.tracking_token defaults to encode(gen_random_bytes(16), 'hex'), and
-- gen_random_bytes lives only in the `extensions` schema.
--
-- gen_random_uuid() is used by most `id` defaults. It exists both in pg_catalog
-- (built in since PG13, which is what actually resolves) and in `extensions`.
--
-- Also installed on the live project but NOT depended on by anything in the
-- public schema, so deliberately left out of the required set:
--   uuid-ossp          1.1   (present, unused - no default calls uuid_generate_v4)
--   pg_stat_statements 1.11  (Supabase observability)
--   supabase_vault     0.3.1 (Supabase managed, `vault` schema)

create schema if not exists extensions;

create extension if not exists pgcrypto with schema extensions;

-- On the live project anon, authenticated and service_role all hold USAGE on
-- `extensions`. This matters and is not decoration: the orders.tracking_token
-- default calls extensions.gen_random_bytes, and a column default runs with the
-- privileges of whoever is inserting. Without this grant every INSERT into
-- orders fails with "permission denied for schema extensions" on a database
-- where this file created the schema itself.
grant usage on schema extensions to anon, authenticated, service_role;


-- ============================================================================
-- 2. ENUM TYPES
-- ============================================================================
--
-- Label order is significant: it defines each type's sort order, and adding a
-- label in the wrong position changes ORDER BY results. These are in the exact
-- order held by the live catalog (pg_enum.enumsortorder).
--
-- `create type` has no IF NOT EXISTS, so each is guarded.

do $$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'public' and t.typname = 'allergen') then
    create type public.allergen as enum (
      'peanuts', 'tree_nuts', 'gluten', 'dairy', 'eggs', 'soy', 'sesame'
    );
  end if;

  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'public' and t.typname = 'dietary_tag') then
    create type public.dietary_tag as enum (
      'eggless', 'vegetarian', 'no_pork_no_lard', 'nut_free', 'vegan', 'dairy_free', 'gluten_free'
    );
  end if;

  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'public' and t.typname = 'fulfillment_type') then
    create type public.fulfillment_type as enum (
      'pickup', 'delivery'
    );
  end if;

  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'public' and t.typname = 'order_status') then
    create type public.order_status as enum (
      'received', 'confirmed', 'baking', 'ready', 'out_for_delivery', 'completed', 'cancelled'
    );
  end if;

  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'public' and t.typname = 'payment_status') then
    create type public.payment_status as enum (
      'pending', 'paid', 'refunded', 'failed'
    );
  end if;
end $$;


-- ============================================================================
-- 3. TABLES  (columns, primary keys, unique constraints, check constraints)
-- ============================================================================
--
-- Foreign keys are deliberately NOT inline. They are added in section 4 after
-- every table exists, so this file has no table-ordering requirement and cannot
-- fail on a forward reference. Tables are listed roughly parent before child,
-- starting at products, which is only for readability and carries no meaning.
--
-- No table uses identity or generated-stored columns. Every surrogate key is a
-- uuid defaulting to gen_random_uuid(); `settings` and `delivery_config` are
-- singleton tables whose integer id defaults to 1 and is pinned by a CHECK.
-- There are therefore no sequences in this schema.

create table if not exists public.products (
  id uuid default gen_random_uuid() not null,
  slug text not null,
  name text not null,
  short_description text,
  long_description text,
  base_price_cents integer not null,
  category text not null,
  image_paths text[] default '{}'::text[] not null,
  is_available boolean default true not null,
  is_best_seller boolean default false not null,
  is_recommended boolean default false not null,
  allergens public.allergen[] default '{}'::public.allergen[] not null,
  dietary_tags public.dietary_tag[] default '{}'::public.dietary_tag[] not null,
  ingredients jsonb default '[]'::jsonb not null,
  storage_info text,
  serving_info text,
  lead_time_days_override integer,
  sort_order integer default 0 not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  stock_count integer,
  available_from timestamp with time zone,
  flavour_box jsonb,
  cost_cents integer,
  personalisation_label text,
  personalisation_allow_photo boolean default false,
  auto_disabled boolean default false not null,
  constraint products_pkey primary key (id),
  constraint products_slug_key unique (slug),
  constraint products_base_price_cents_check check ((base_price_cents >= 0))
);

create table if not exists public.product_options (
  id uuid default gen_random_uuid() not null,
  product_id uuid not null,
  name text not null,
  required boolean default true not null,
  sort_order integer default 0 not null,
  constraint product_options_pkey primary key (id)
);

create table if not exists public.product_option_values (
  id uuid default gen_random_uuid() not null,
  option_id uuid not null,
  label text not null,
  price_delta_cents integer default 0 not null,
  is_available boolean default true not null,
  sort_order integer default 0 not null,
  constraint product_option_values_pkey primary key (id)
);

create table if not exists public.related_products (
  product_id uuid not null,
  related_product_id uuid not null,
  sort_order integer default 0 not null,
  constraint related_products_pkey primary key (product_id, related_product_id)
);

create table if not exists public.bundles (
  id uuid default gen_random_uuid() not null,
  name text not null,
  slug text not null,
  description text,
  price_cents integer not null,
  image_path text,
  is_active boolean default true not null,
  sort_order integer default 0 not null,
  created_at timestamp with time zone default now() not null,
  constraint bundles_pkey primary key (id),
  constraint bundles_slug_key unique (slug),
  constraint bundles_price_cents_check check ((price_cents >= 0))
);

create table if not exists public.bundle_items (
  id uuid default gen_random_uuid() not null,
  bundle_id uuid not null,
  product_id uuid not null,
  quantity integer default 1 not null,
  constraint bundle_items_pkey primary key (id),
  constraint bundle_items_quantity_check check ((quantity > 0))
);

create table if not exists public.box_templates (
  id uuid default gen_random_uuid() not null,
  name text not null,
  slug text not null,
  item_count integer not null,
  price_cents integer not null,
  eligible_category text,
  is_active boolean default true not null,
  sort_order integer default 0 not null,
  created_at timestamp with time zone default now() not null,
  constraint box_templates_pkey primary key (id),
  constraint box_templates_slug_key unique (slug),
  constraint box_templates_item_count_check check ((item_count > 0)),
  constraint box_templates_price_cents_check check ((price_cents >= 0))
);

create table if not exists public.box_template_items (
  id uuid default gen_random_uuid() not null,
  box_template_id uuid not null,
  product_id uuid not null,
  constraint box_template_items_pkey primary key (id)
);

-- EXTERNAL DEPENDENCY: profiles.id references auth.users(id).
-- Rows are created by the public.handle_new_user() trigger in section 8.
create table if not exists public.profiles (
  id uuid not null,
  full_name text,
  phone text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  referral_code text default upper(substr(md5((random())::text), 1, 6)),
  referred_by text,
  birthday date,
  birthday_rewarded_year integer,
  dietary_prefs public.dietary_tag[] default '{}'::public.dietary_tag[] not null,
  winback_sent_at timestamp with time zone,
  constraint profiles_pkey primary key (id)
);

-- EXTERNAL DEPENDENCY: addresses.user_id references auth.users(id).
create table if not exists public.addresses (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  label text,
  line1 text not null,
  unit text,
  postal_code text not null,
  created_at timestamp with time zone default now() not null,
  constraint addresses_pkey primary key (id)
);

-- EXTERNAL DEPENDENCY: orders.user_id references auth.users(id).
-- tracking_token's default calls extensions.gen_random_bytes (pgcrypto). The
-- live catalog resolves it to exactly that function, so it is written schema
-- qualified here rather than left to the search_path. gen_random_uuid() below
-- is NOT qualified because it resolves to the pg_catalog built in, which is
-- what the live database uses.
create table if not exists public.orders (
  id uuid default gen_random_uuid() not null,
  order_number text not null,
  tracking_token text default encode(extensions.gen_random_bytes(16), 'hex'::text) not null,
  status public.order_status default 'received'::public.order_status not null,
  payment_status public.payment_status default 'pending'::public.payment_status not null,
  fulfillment_type public.fulfillment_type not null,
  scheduled_date date not null,
  time_window text,
  delivery_address jsonb,
  customer_name text not null,
  email text not null,
  phone text not null,
  notes text,
  subtotal_cents integer not null,
  delivery_fee_cents integer default 0 not null,
  total_cents integer not null,
  currency text default 'SGD'::text not null,
  stripe_payment_intent_id text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  user_id uuid,
  discount_cents integer default 0 not null,
  points_redeemed integer default 0 not null,
  promo_code text,
  is_gift boolean default false not null,
  gift_message text,
  recipient_name text,
  recipient_phone text,
  note_answers jsonb default '[]'::jsonb not null,
  reschedule_count integer default 0 not null,
  owner_note text,
  stock_decremented_at timestamp with time zone,
  review_request_sent_at timestamp with time zone,
  deposit_cents integer,
  recipient_token text,
  recipient_scheduled_at timestamp with time zone,
  constraint orders_pkey primary key (id),
  constraint orders_order_number_key unique (order_number),
  constraint orders_recipient_token_key unique (recipient_token),
  constraint orders_tracking_token_key unique (tracking_token),
  constraint orders_delivery_fee_cents_check check ((delivery_fee_cents >= 0)),
  constraint orders_discount_cents_check check ((discount_cents >= 0)),
  constraint orders_points_redeemed_check check ((points_redeemed >= 0)),
  constraint orders_subtotal_cents_check check ((subtotal_cents >= 0)),
  constraint orders_total_cents_check check ((total_cents >= 0))
);

create table if not exists public.order_items (
  id uuid default gen_random_uuid() not null,
  order_id uuid not null,
  product_id uuid,
  product_name text not null,
  unit_price_cents integer not null,
  quantity integer not null,
  selected_options jsonb default '[]'::jsonb not null,
  line_total_cents integer not null,
  personalisation jsonb,
  constraint order_items_pkey primary key (id),
  constraint order_items_line_total_cents_check check ((line_total_cents >= 0)),
  constraint order_items_quantity_check check ((quantity > 0)),
  constraint order_items_unit_price_cents_check check ((unit_price_cents >= 0))
);

create table if not exists public.checkout_intents (
  id uuid default gen_random_uuid() not null,
  email text not null,
  items jsonb not null,
  subtotal_cents integer default 0 not null,
  created_at timestamp with time zone default now() not null,
  reminded_at timestamp with time zone,
  converted_order_id uuid,
  constraint checkout_intents_pkey primary key (id)
);

-- EXTERNAL DEPENDENCY: points_ledger.user_id references auth.users(id).
create table if not exists public.points_ledger (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  order_id uuid,
  delta integer not null,
  reason text not null,
  created_at timestamp with time zone default now() not null,
  constraint points_ledger_pkey primary key (id)
);

create table if not exists public.promo_codes (
  id uuid default gen_random_uuid() not null,
  code text not null,
  discount_type text not null,
  discount_value integer not null,
  min_order_cents integer default 0 not null,
  active boolean default true not null,
  expires_at date,
  created_at timestamp with time zone default now() not null,
  max_redemptions integer,
  per_customer_limit integer,
  first_order_only boolean default false not null,
  constraint promo_codes_pkey primary key (id),
  constraint promo_codes_code_key unique (code),
  constraint promo_codes_discount_type_check check ((discount_type = any (array['percent'::text, 'amount'::text, 'free_delivery'::text]))),
  constraint promo_codes_discount_value_check check ((discount_value >= 0))
);

-- EXTERNAL DEPENDENCY: both user columns reference auth.users(id).
create table if not exists public.referrals (
  id uuid default gen_random_uuid() not null,
  referrer_user_id uuid not null,
  referee_user_id uuid not null,
  code text not null,
  status text default 'pending'::text not null,
  created_at timestamp with time zone default now() not null,
  rewarded_at timestamp with time zone,
  constraint referrals_pkey primary key (id),
  constraint referrals_status_check check ((status = any (array['pending'::text, 'rewarded'::text])))
);

-- EXTERNAL DEPENDENCY: reviews.user_id references auth.users(id).
create table if not exists public.reviews (
  id uuid default gen_random_uuid() not null,
  product_id uuid not null,
  user_id uuid not null,
  rating integer not null,
  body text,
  author_name text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  image_paths text[] default '{}'::text[] not null,
  constraint reviews_pkey primary key (id),
  constraint reviews_product_id_user_id_key unique (product_id, user_id),
  constraint reviews_rating_check check (((rating >= 1) and (rating <= 5)))
);

-- EXTERNAL DEPENDENCY: wishlists.user_id references auth.users(id).
create table if not exists public.wishlists (
  user_id uuid not null,
  product_id uuid not null,
  created_at timestamp with time zone default now() not null,
  constraint wishlists_pkey primary key (user_id, product_id)
);

-- EXTERNAL DEPENDENCY: wishlist_shares.user_id references auth.users(id).
create table if not exists public.wishlist_shares (
  token text not null,
  user_id uuid not null,
  created_at timestamp with time zone default now() not null,
  constraint wishlist_shares_pkey primary key (token),
  constraint wishlist_shares_user_id_key unique (user_id)
);

-- EXTERNAL DEPENDENCY: occasions.user_id references auth.users(id).
create table if not exists public.occasions (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  label text not null,
  month smallint not null,
  day smallint not null,
  remind_days_before smallint default 7 not null,
  last_reminded_on date,
  created_at timestamp with time zone default now() not null,
  constraint occasions_pkey primary key (id),
  constraint occasions_day_check check (((day >= 1) and (day <= 31))),
  constraint occasions_month_check check (((month >= 1) and (month <= 12))),
  constraint occasions_remind_days_before_check check (((remind_days_before >= 0) and (remind_days_before <= 60)))
);

-- EXTERNAL DEPENDENCY: stock_notifications.user_id references auth.users(id).
create table if not exists public.stock_notifications (
  id uuid default gen_random_uuid() not null,
  product_id uuid not null,
  email text not null,
  user_id uuid,
  created_at timestamp with time zone default now() not null,
  notified_at timestamp with time zone,
  confirm_token text,
  confirmed_at timestamp with time zone,
  constraint stock_notifications_pkey primary key (id)
);

create table if not exists public.newsletter_subscribers (
  id uuid default gen_random_uuid() not null,
  email text not null,
  consented_at timestamp with time zone default now() not null,
  unsubscribe_token text not null,
  unsubscribed_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  confirm_token text,
  confirmed_at timestamp with time zone,
  constraint newsletter_subscribers_pkey primary key (id),
  constraint newsletter_subscribers_unsubscribe_token_key unique (unsubscribe_token)
);

create table if not exists public.instagram_posts (
  id uuid default gen_random_uuid() not null,
  image_url text not null,
  link_url text not null,
  caption text,
  sort_order integer default 0 not null,
  is_active boolean default true not null,
  created_at timestamp with time zone default now() not null,
  constraint instagram_posts_pkey primary key (id)
);

-- Singleton table, pinned to id = 1 by a CHECK.
create table if not exists public.settings (
  id integer default 1 not null,
  delivery_fee_cents integer default 800 not null,
  free_delivery_min_cents integer,
  min_order_cents integer default 0 not null,
  lead_time_days integer default 2 not null,
  daily_order_cap integer,
  blackout_dates date[] default '{}'::date[] not null,
  pickup_location_public text,
  pickup_address_private text,
  time_windows text[] default '{"Morning (9am–12pm)","Afternoon (12–4pm)","Evening (4–8pm)"}'::text[] not null,
  payment_methods_enabled text[] default '{paynow,card,wallet}'::text[] not null,
  contact_email text,
  contact_phone text,
  whatsapp text,
  instagram text,
  updated_at timestamp with time zone default now() not null,
  points_per_dollar integer default 1 not null,
  point_value_cents integer default 5 not null,
  referral_referrer_points integer default 50 not null,
  referral_referee_points integer default 30 not null,
  feature_rewards boolean default true not null,
  feature_wishlist boolean default true not null,
  feature_reviews boolean default true not null,
  feature_promos boolean default true not null,
  feature_gifting boolean default true not null,
  feature_referrals boolean default true not null,
  feature_build_a_box boolean default true not null,
  feature_bundles boolean default true not null,
  feature_spend_gift boolean default true not null,
  feature_back_in_stock boolean default true not null,
  feature_photo_reviews boolean default true not null,
  feature_cart_sharing boolean default true not null,
  feature_wishlist_sharing boolean default true not null,
  feature_instagram_feed boolean default true not null,
  feature_birthday_rewards boolean default true not null,
  feature_abandoned_cart boolean default true not null,
  feature_structured_notes boolean default true not null,
  per_window_cap integer,
  daily_cutoff_time time without time zone,
  free_gift_threshold_cents integer,
  free_gift_product_id uuid,
  birthday_reward_points integer default 0 not null,
  abandoned_after_hours integer default 4 not null,
  note_prompts jsonb default '[]'::jsonb not null,
  feature_order_changes boolean default true not null,
  feature_newsletter boolean default true not null,
  feature_drops boolean default true not null,
  feature_dietary_prefs boolean default true not null,
  low_stock_threshold integer,
  mascot_message text,
  feature_occasion_reminders boolean default true,
  constraint settings_pkey primary key (id),
  constraint settings_id_check check ((id = 1))
);

-- Singleton table, pinned to id = 1 by a CHECK.
create table if not exists public.delivery_config (
  id integer default 1 not null,
  kitchen_postal text,
  kitchen_lat double precision,
  kitchen_lng double precision,
  distance_tiers jsonb default '[]'::jsonb not null,
  updated_at timestamp with time zone default now() not null,
  constraint delivery_config_pkey primary key (id),
  constraint delivery_config_single_row check ((id = 1))
);

create table if not exists public.delivery_distance_cache (
  delivery_postal text not null,
  kitchen_postal text not null,
  distance_m integer not null,
  delivery_lat double precision,
  delivery_lng double precision,
  resolved_at timestamp with time zone default now() not null,
  constraint delivery_distance_cache_pkey primary key (delivery_postal, kitchen_postal)
);


-- ============================================================================
-- 4. FOREIGN KEYS
-- ============================================================================
--
-- ON DELETE behaviour is load-bearing and varies. Note especially:
--   bundle_items.product_id -> products  ON DELETE RESTRICT
--     A product that is part of a bundle cannot be deleted. Every other
--     product reference is CASCADE or SET NULL.
--   order_items.product_id -> products   ON DELETE SET NULL
--     Deleting a product must not destroy order history; the line keeps its
--     denormalised product_name and price.
--   orders.user_id -> auth.users         ON DELETE SET NULL
--     Deleting an account keeps the order, orphaned.
--
-- EXTERNAL DEPENDENCY: eleven of these reference auth.users, a Supabase-managed
-- table. On a rebuild, the auth schema must already exist (it does on any
-- Supabase project and after `supabase start`).
--
-- Applied through a catalog check so re-running the file is safe.

do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('addresses',             'addresses_user_id_fkey',                 'foreign key (user_id) references auth.users(id) on delete cascade'),
      ('box_template_items',    'box_template_items_box_template_id_fkey', 'foreign key (box_template_id) references public.box_templates(id) on delete cascade'),
      ('box_template_items',    'box_template_items_product_id_fkey',     'foreign key (product_id) references public.products(id) on delete cascade'),
      ('bundle_items',          'bundle_items_bundle_id_fkey',            'foreign key (bundle_id) references public.bundles(id) on delete cascade'),
      ('bundle_items',          'bundle_items_product_id_fkey',           'foreign key (product_id) references public.products(id) on delete restrict'),
      ('checkout_intents',      'checkout_intents_converted_order_id_fkey', 'foreign key (converted_order_id) references public.orders(id) on delete set null'),
      ('occasions',             'occasions_user_id_fkey',                 'foreign key (user_id) references auth.users(id) on delete cascade'),
      ('order_items',           'order_items_order_id_fkey',              'foreign key (order_id) references public.orders(id) on delete cascade'),
      ('order_items',           'order_items_product_id_fkey',            'foreign key (product_id) references public.products(id) on delete set null'),
      ('orders',                'orders_user_id_fkey',                    'foreign key (user_id) references auth.users(id) on delete set null'),
      ('points_ledger',         'points_ledger_order_id_fkey',            'foreign key (order_id) references public.orders(id) on delete set null'),
      ('points_ledger',         'points_ledger_user_id_fkey',             'foreign key (user_id) references auth.users(id) on delete cascade'),
      ('product_option_values', 'product_option_values_option_id_fkey',   'foreign key (option_id) references public.product_options(id) on delete cascade'),
      ('product_options',       'product_options_product_id_fkey',        'foreign key (product_id) references public.products(id) on delete cascade'),
      ('profiles',              'profiles_id_fkey',                       'foreign key (id) references auth.users(id) on delete cascade'),
      ('referrals',             'referrals_referee_user_id_fkey',         'foreign key (referee_user_id) references auth.users(id) on delete cascade'),
      ('referrals',             'referrals_referrer_user_id_fkey',        'foreign key (referrer_user_id) references auth.users(id) on delete cascade'),
      ('related_products',      'related_products_product_id_fkey',       'foreign key (product_id) references public.products(id) on delete cascade'),
      ('related_products',      'related_products_related_product_id_fkey', 'foreign key (related_product_id) references public.products(id) on delete cascade'),
      ('reviews',               'reviews_product_id_fkey',                'foreign key (product_id) references public.products(id) on delete cascade'),
      ('reviews',               'reviews_user_id_fkey',                   'foreign key (user_id) references auth.users(id) on delete cascade'),
      ('settings',              'settings_free_gift_product_id_fkey',     'foreign key (free_gift_product_id) references public.products(id) on delete set null'),
      ('stock_notifications',   'stock_notifications_product_id_fkey',    'foreign key (product_id) references public.products(id) on delete cascade'),
      ('stock_notifications',   'stock_notifications_user_id_fkey',       'foreign key (user_id) references auth.users(id) on delete set null'),
      ('wishlist_shares',       'wishlist_shares_user_id_fkey',           'foreign key (user_id) references auth.users(id) on delete cascade'),
      ('wishlists',             'wishlists_product_id_fkey',              'foreign key (product_id) references public.products(id) on delete cascade'),
      ('wishlists',             'wishlists_user_id_fkey',                 'foreign key (user_id) references auth.users(id) on delete cascade')
    ) as t(tbl, con, def)
  loop
    if not exists (
      select 1
        from pg_constraint c
        join pg_class rel on rel.oid = c.conrelid
        join pg_namespace n on n.oid = rel.relnamespace
       where n.nspname = 'public' and rel.relname = r.tbl and c.conname = r.con
    ) then
      execute format('alter table public.%I add constraint %I %s', r.tbl, r.con, r.def);
    end if;
  end loop;
end $$;


-- ============================================================================
-- 5. INDEXES
-- ============================================================================
--
-- Only indexes that are NOT already created by a primary key or unique
-- constraint in section 3. Several are partial, and the WHERE clause is what
-- makes them correct rather than merely fast:
--
--   points_earned_once / points_redeemed_once
--     Partial unique on order_id, one per reason. These are the replay guards
--     that stop an order awarding or redeeming points twice.
--   stock_notifications_unique
--     Partial unique on (product_id, lower(email)) WHERE notified_at is null.
--     One pending back-in-stock alert per address, but re-subscribing after
--     being notified is allowed.
--   newsletter_subscribers_confirm_token_key / stock_notifications_confirm_token_key
--     Unique only over non-null tokens, so many rows may sit with no token.
--
-- profiles_referral_code_key is a bare unique INDEX, not a unique CONSTRAINT,
-- despite the constraint-style name. Reproduced as an index to match live.

create index if not exists checkout_intents_pending on public.checkout_intents using btree (created_at) where ((reminded_at is null) and (converted_order_id is null));

create unique index if not exists newsletter_subscribers_confirm_token_key on public.newsletter_subscribers using btree (confirm_token) where (confirm_token is not null);
create unique index if not exists newsletter_subscribers_email_unique on public.newsletter_subscribers using btree (lower(email));

create index if not exists occasions_user_idx on public.occasions using btree (user_id);

create index if not exists order_items_order_idx on public.order_items using btree (order_id);

create index if not exists orders_created_at_idx on public.orders using btree (created_at desc);
create index if not exists orders_scheduled_date_idx on public.orders using btree (scheduled_date);
create index if not exists orders_status_idx on public.orders using btree (status);
create index if not exists orders_user_idx on public.orders using btree (user_id);

create unique index if not exists points_earned_once on public.points_ledger using btree (order_id) where (reason = 'earned'::text);
create unique index if not exists points_redeemed_once on public.points_ledger using btree (order_id) where (reason = 'redeemed'::text);
create index if not exists points_ledger_user_idx on public.points_ledger using btree (user_id);

create index if not exists product_option_values_option_idx on public.product_option_values using btree (option_id);
create index if not exists product_options_product_idx on public.product_options using btree (product_id);

create index if not exists products_available_idx on public.products using btree (is_available);
create index if not exists products_category_idx on public.products using btree (category);

create unique index if not exists profiles_referral_code_key on public.profiles using btree (referral_code);

create unique index if not exists referrals_referee_once on public.referrals using btree (referee_user_id);
create index if not exists referrals_referrer_idx on public.referrals using btree (referrer_user_id);

create index if not exists reviews_product_idx on public.reviews using btree (product_id);

create unique index if not exists stock_notifications_confirm_token_key on public.stock_notifications using btree (confirm_token) where (confirm_token is not null);
create unique index if not exists stock_notifications_unique on public.stock_notifications using btree (product_id, lower(email)) where (notified_at is null);

create index if not exists wishlists_user_idx on public.wishlists using btree (user_id);


-- ============================================================================
-- 6. VIEWS
-- ============================================================================
--
-- public_product_reviews is SECURITY INVOKER. That is deliberate and it is the
-- whole point of the view: because the caller's own privileges apply, and anon
-- holds column-level SELECT on exactly these six columns of `reviews` (see
-- section 10), the view cannot become a way to read reviews.user_id or any
-- other withheld column. Recreating it as security definer (the Postgres
-- default) would silently undo that.

create or replace view public.public_product_reviews
  with (security_invoker = on)
as
 select product_id,
    rating,
    body,
    author_name,
    created_at,
    image_paths
   from public.reviews;


-- ============================================================================
-- 7. FUNCTIONS
-- ============================================================================
--
-- Six functions. Three are transactional helpers called by the server with the
-- service role; two are SECURITY DEFINER token lookups callable by anon; one is
-- the auth.users trigger function.
--
-- All are VOLATILE. The three SECURITY DEFINER functions pin search_path to
-- 'public', which is what stops a caller-controlled search_path from
-- redirecting the unqualified names inside their bodies.

-- Writes an order and all its line items in one statement so a failure part way
-- through cannot leave a paid order with no items. Takes an advisory lock keyed
-- on the scheduled date so two concurrent checkouts cannot both pass the daily
-- or per-window capacity check.
create or replace function public.create_order_with_items(p_order jsonb, p_items jsonb, p_daily_cap integer default null::integer, p_window_cap integer default null::integer)
 returns void
 language plpgsql
as $function$
declare
  v_order_id uuid := (p_order->>'id')::uuid;
  v_date date := (p_order->>'scheduled_date')::date;
  v_window text := p_order->>'time_window';
  v_count integer;
  r jsonb;
begin
  perform pg_advisory_xact_lock(hashtext('order-capacity:' || (p_order->>'scheduled_date')));

  if p_daily_cap is not null and p_daily_cap > 0 then
    select count(*) into v_count
      from public.orders
     where scheduled_date = v_date
       and status <> 'cancelled';
    if v_count >= p_daily_cap then
      raise exception 'capacity_day_full';
    end if;
  end if;

  if p_window_cap is not null and p_window_cap > 0 and coalesce(v_window, '') <> '' then
    select count(*) into v_count
      from public.orders
     where scheduled_date = v_date
       and time_window = v_window
       and status <> 'cancelled';
    if v_count >= p_window_cap then
      raise exception 'capacity_window_full';
    end if;
  end if;

  insert into public.orders (
    id, order_number, tracking_token, recipient_token, user_id,
    fulfillment_type, scheduled_date, time_window, delivery_address,
    customer_name, email, phone, notes, is_gift, gift_message,
    recipient_name, recipient_phone, subtotal_cents, delivery_fee_cents,
    discount_cents, points_redeemed, promo_code, note_answers, total_cents,
    currency
  ) values (
    v_order_id,
    p_order->>'order_number',
    p_order->>'tracking_token',
    p_order->>'recipient_token',
    (p_order->>'user_id')::uuid,
    (p_order->>'fulfillment_type')::public.fulfillment_type,
    v_date,
    v_window,
    nullif(p_order->'delivery_address', 'null'::jsonb),
    p_order->>'customer_name',
    p_order->>'email',
    p_order->>'phone',
    p_order->>'notes',
    coalesce((p_order->>'is_gift')::boolean, false),
    p_order->>'gift_message',
    p_order->>'recipient_name',
    p_order->>'recipient_phone',
    (p_order->>'subtotal_cents')::integer,
    (p_order->>'delivery_fee_cents')::integer,
    coalesce((p_order->>'discount_cents')::integer, 0),
    coalesce((p_order->>'points_redeemed')::integer, 0),
    p_order->>'promo_code',
    coalesce(p_order->'note_answers', '[]'::jsonb),
    (p_order->>'total_cents')::integer,
    coalesce(p_order->>'currency', 'SGD')
  );

  for r in select value from jsonb_array_elements(p_items)
  loop
    insert into public.order_items (
      order_id, product_id, product_name, unit_price_cents, quantity,
      selected_options, personalisation, line_total_cents
    ) values (
      v_order_id,
      (r->>'product_id')::uuid,
      r->>'product_name',
      (r->>'unit_price_cents')::integer,
      (r->>'quantity')::integer,
      coalesce(r->'selected_options', '[]'::jsonb),
      nullif(r->'personalisation', 'null'::jsonb),
      (r->>'line_total_cents')::integer
    );
  end loop;
end;
$function$;

-- Adds items to an existing order and moves the money in the same statement, so
-- the totals can never drift from the lines.
create or replace function public.add_items_to_order(p_order_id uuid, p_items jsonb, p_added_cents integer)
 returns void
 language plpgsql
as $function$
declare
  r jsonb;
begin
  for r in select value from jsonb_array_elements(p_items)
  loop
    insert into public.order_items (
      order_id, product_id, product_name, unit_price_cents, quantity,
      selected_options, line_total_cents
    ) values (
      p_order_id,
      (r->>'product_id')::uuid,
      r->>'product_name',
      (r->>'unit_price_cents')::integer,
      (r->>'quantity')::integer,
      coalesce(r->'selected_options', '[]'::jsonb),
      (r->>'line_total_cents')::integer
    );
  end loop;

  update public.orders
     set subtotal_cents = subtotal_cents + p_added_cents,
         total_cents = total_cents + p_added_cents,
         updated_at = now()
   where id = p_order_id;

  if not found then
    raise exception 'order_not_found';
  end if;
end;
$function$;

-- SELECT ... FOR UPDATE makes the read-modify-write atomic, so two concurrent
-- orders cannot oversell the same unit. Also handles auto-disable at zero and
-- re-enable on restock, but only re-enables what IT disabled (auto_disabled),
-- so a product Michelle turned off by hand stays off.
create or replace function public.adjust_product_stock(p_id uuid, p_delta integer)
 returns table(old_count integer, new_count integer, product_name text, re_enabled boolean)
 language plpgsql
as $function$
declare
  v_old integer;
  v_name text;
  v_new integer;
  v_was_auto_disabled boolean;
  v_re_enabled boolean := false;
begin
  select stock_count, name, auto_disabled into v_old, v_name, v_was_auto_disabled
    from public.products
   where id = p_id
   for update;

  if not found or v_old is null then
    return;
  end if;

  v_new := greatest(0, v_old + p_delta);
  v_re_enabled := v_old <= 0 and v_new > 0 and coalesce(v_was_auto_disabled, false);

  update public.products
     set stock_count = v_new,
         is_available = case
           when v_new <= 0 then false
           when v_re_enabled then true
           else is_available
         end,
         auto_disabled = case
           when v_new <= 0 and is_available then true
           when v_re_enabled then false
           else auto_disabled
         end,
         updated_at = now()
   where id = p_id;

  old_count := v_old;
  new_count := v_new;
  product_name := v_name;
  re_enabled := v_re_enabled;
  return next;
end;
$function$;

-- Guest order tracking. SECURITY DEFINER so an unauthenticated visitor holding
-- the token can read one order without any table grant on `orders`. The
-- returned JSON is an explicit allow-list of columns, which is what keeps
-- owner_note and stripe_payment_intent_id out of it.
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
        'personalisation', oi.personalisation,
        'line_total_cents', oi.line_total_cents
      ) order by oi.id)
      from order_items oi where oi.order_id = o.id
    ), '[]'::jsonb)
  )
  from orders o
  where o.tracking_token = p_token;
$function$;

-- Gift recipient view. Narrower than get_order_by_token on purpose: the
-- recipient sees the sender, the message and the delivery slot, never the
-- money.
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

-- EXTERNAL DEPENDENCY: fired by a trigger on auth.users (section 8).
-- SECURITY DEFINER because the signing-up user has no rights on profiles yet.
create or replace function public.handle_new_user()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  insert into public.profiles (id, full_name)
  values (new.id, new.raw_user_meta_data ->> 'full_name')
  on conflict (id) do nothing;
  return new;
end;
$function$;


-- ============================================================================
-- 8. TRIGGERS
-- ============================================================================
--
-- Exactly one trigger in the whole database, and it does not live on a public
-- table.
--
-- EXTERNAL DEPENDENCY: this trigger is created ON auth.users, a Supabase-managed
-- table, and it is included here despite that rule because without it no
-- profile row is ever created and signup is silently broken. Creating it
-- requires ownership of auth.users, which on Supabase means running as the
-- `postgres` / `supabase_admin` role. If a rebuild runs as a lesser role, this
-- statement is the one that will fail.

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ============================================================================
-- 9. ROW LEVEL SECURITY
-- ============================================================================
--
-- RLS is enabled on all 26 public tables. Nine of them carry NO policy at all,
-- which is not an oversight: RLS on with zero policies denies every row to
-- anon and authenticated, leaving them reachable only by the service role,
-- which bypasses RLS. Those nine are:
--
--   checkout_intents, delivery_config, delivery_distance_cache,
--   newsletter_subscribers, order_items, promo_codes, referrals,
--   stock_notifications, wishlist_shares
--
-- Treat that as the intended design. Adding a policy to any of them opens a
-- table that is currently server-only.
--
-- CAUTION: order_items is in that list, so a customer can read their order rows
-- but not the line items directly. The tracking page gets items through
-- get_order_by_token instead.

alter table public.addresses enable row level security;
alter table public.box_template_items enable row level security;
alter table public.box_templates enable row level security;
alter table public.bundle_items enable row level security;
alter table public.bundles enable row level security;
alter table public.checkout_intents enable row level security;
alter table public.delivery_config enable row level security;
alter table public.delivery_distance_cache enable row level security;
alter table public.instagram_posts enable row level security;
alter table public.newsletter_subscribers enable row level security;
alter table public.occasions enable row level security;
alter table public.order_items enable row level security;
alter table public.orders enable row level security;
alter table public.points_ledger enable row level security;
alter table public.product_option_values enable row level security;
alter table public.product_options enable row level security;
alter table public.products enable row level security;
alter table public.profiles enable row level security;
alter table public.promo_codes enable row level security;
alter table public.referrals enable row level security;
alter table public.related_products enable row level security;
alter table public.reviews enable row level security;
alter table public.settings enable row level security;
alter table public.stock_notifications enable row level security;
alter table public.wishlist_shares enable row level security;
alter table public.wishlists enable row level security;

-- No table uses FORCE ROW LEVEL SECURITY, so the table owner (postgres) is
-- exempt from its own policies.

-- ---- Catalogue: readable by everyone -------------------------------------

drop policy if exists "Public can read products" on public.products;
create policy "Public can read products" on public.products
  as permissive for select to public
  using (true);

drop policy if exists "Public can read product options" on public.product_options;
create policy "Public can read product options" on public.product_options
  as permissive for select to public
  using (true);

drop policy if exists "Public can read option values" on public.product_option_values;
create policy "Public can read option values" on public.product_option_values
  as permissive for select to public
  using (true);

drop policy if exists "Public can read related products" on public.related_products;
create policy "Public can read related products" on public.related_products
  as permissive for select to public
  using (true);

drop policy if exists "Public can read settings" on public.settings;
create policy "Public can read settings" on public.settings
  as permissive for select to public
  using (true);

-- ---- Merchandising: only rows flagged active -----------------------------

drop policy if exists "public reads active bundles" on public.bundles;
create policy "public reads active bundles" on public.bundles
  as permissive for select to public
  using (is_active);

drop policy if exists "public reads bundle items" on public.bundle_items;
create policy "public reads bundle items" on public.bundle_items
  as permissive for select to public
  using ((exists ( select 1
   from public.bundles b
  where ((b.id = bundle_items.bundle_id) and b.is_active))));

drop policy if exists "public reads active box templates" on public.box_templates;
create policy "public reads active box templates" on public.box_templates
  as permissive for select to public
  using (is_active);

drop policy if exists "public reads box items" on public.box_template_items;
create policy "public reads box items" on public.box_template_items
  as permissive for select to public
  using ((exists ( select 1
   from public.box_templates t
  where ((t.id = box_template_items.box_template_id) and t.is_active))));

drop policy if exists "public reads active instagram" on public.instagram_posts;
create policy "public reads active instagram" on public.instagram_posts
  as permissive for select to public
  using (is_active);

-- ---- Reviews --------------------------------------------------------------
-- Scoped to anon and authenticated rather than PUBLIC, the only policy in the
-- schema that names roles. Which COLUMNS are visible is decided by the
-- column-level grant in section 10, not by this policy.

drop policy if exists "Public can read review content" on public.reviews;
create policy "Public can read review content" on public.reviews
  as permissive for select to anon, authenticated
  using (true);

-- ---- Per-user data --------------------------------------------------------

drop policy if exists "Users read own profile" on public.profiles;
create policy "Users read own profile" on public.profiles
  as permissive for select to public
  using ((auth.uid() = id));

drop policy if exists "Users insert own profile" on public.profiles;
create policy "Users insert own profile" on public.profiles
  as permissive for insert to public
  with check ((auth.uid() = id));

-- NOTE: no WITH CHECK on this one, matching live. USING alone gates which rows
-- may be updated but does not constrain the resulting row, so a user could in
-- principle update their profile row's id. The primary key and the FK to
-- auth.users are what actually prevent it.
drop policy if exists "Users update own profile" on public.profiles;
create policy "Users update own profile" on public.profiles
  as permissive for update to public
  using ((auth.uid() = id));

drop policy if exists "Users manage own addresses" on public.addresses;
create policy "Users manage own addresses" on public.addresses
  as permissive for all to public
  using ((auth.uid() = user_id))
  with check ((auth.uid() = user_id));

drop policy if exists "Users read own orders" on public.orders;
create policy "Users read own orders" on public.orders
  as permissive for select to public
  using ((auth.uid() = user_id));

drop policy if exists "Users read own points" on public.points_ledger;
create policy "Users read own points" on public.points_ledger
  as permissive for select to public
  using ((auth.uid() = user_id));

drop policy if exists "Users manage own wishlist" on public.wishlists;
create policy "Users manage own wishlist" on public.wishlists
  as permissive for all to public
  using ((auth.uid() = user_id))
  with check ((auth.uid() = user_id));

drop policy if exists "occasions_select_own" on public.occasions;
create policy "occasions_select_own" on public.occasions
  as permissive for select to public
  using ((auth.uid() = user_id));

drop policy if exists "occasions_insert_own" on public.occasions;
create policy "occasions_insert_own" on public.occasions
  as permissive for insert to public
  with check ((auth.uid() = user_id));

drop policy if exists "occasions_update_own" on public.occasions;
create policy "occasions_update_own" on public.occasions
  as permissive for update to public
  using ((auth.uid() = user_id))
  with check ((auth.uid() = user_id));

drop policy if exists "occasions_delete_own" on public.occasions;
create policy "occasions_delete_own" on public.occasions
  as permissive for delete to public
  using ((auth.uid() = user_id));


-- ============================================================================
-- 10. GRANTS
-- ============================================================================
--
-- ### READ THIS BEFORE CHANGING ANYTHING HERE ###
--
-- This section reproduces the live grants EXACTLY, including a defect. It is a
-- record of what is, not what was intended.
--
-- The pattern the repo uses to hide a column from the public REST API is:
--     revoke select on <table> from anon, authenticated;
--     grant select (<allow-list>) on <table> to anon, authenticated;
-- A table-level grant outranks column-level grants. If the table-level SELECT is
-- ever re-granted, the column list becomes decorative and every column is
-- readable again, with nothing in the catalog to flag it.
--
-- That is the current state of the live database:
--
--   reviews   REVOKE held. Column list is live and enforced.
--             anon cannot read reviews.user_id. Correct.
--
--   products  REVOKE was undone. anon holds table-level SELECT *and* a
--             25-column list. Verified live: has_column_privilege('anon',
--             'public.products', 'cost_cents', 'SELECT') = true.
--             products.cost_cents (unit cost, i.e. margin) is READABLE with the
--             public anon key today. So is auto_disabled.
--
--   settings  REVOKE was undone. Same shape.
--             settings.pickup_address_private (the home pickup address) is
--             READABLE with the public anon key today.
--
--   orders    Never narrowed on live at all. No column grants exist.
--   profiles  anon and authenticated hold full table SELECT, and full table
--             UPDATE on profiles. Repo migration 0035 was written to fix both
--             and has not taken effect on live.
--             Live consequence: orders.owner_note, recipient_token and
--             stripe_payment_intent_id are readable by the signed-in customer,
--             and profiles.birthday_rewarded_year / winback_sent_at are
--             writable by them.
--
-- Two of those column lists are also stale in a second way: they were computed
-- from the catalog at the time they ran, so columns added afterwards
-- (products.auto_disabled) are simply absent from the list rather than
-- deliberately excluded.
--
-- Fixing this is a schema change with a deployment-ordering hazard and is out
-- of scope for a baseline. It belongs in its own migration, applied only after
-- the code that depends on the narrowed columns is live. See the sequencing
-- warning in 0035.
--
-- Every table below also grants ALL to anon and authenticated, which is the
-- stock Supabase posture: RLS, not grants, is the row-level gate. The grants
-- only ever matter at column granularity.

grant usage on schema public to anon, authenticated, service_role;

-- ---- Table-level grants ---------------------------------------------------

grant all on table public.addresses               to anon, authenticated, service_role;
grant all on table public.box_template_items      to anon, authenticated, service_role;
grant all on table public.box_templates           to anon, authenticated, service_role;
grant all on table public.bundle_items            to anon, authenticated, service_role;
grant all on table public.bundles                 to anon, authenticated, service_role;
grant all on table public.checkout_intents        to anon, authenticated, service_role;
grant all on table public.delivery_config         to anon, authenticated, service_role;
grant all on table public.delivery_distance_cache to anon, authenticated, service_role;
grant all on table public.instagram_posts         to anon, authenticated, service_role;
grant all on table public.newsletter_subscribers  to anon, authenticated, service_role;
grant all on table public.occasions               to anon, authenticated, service_role;
grant all on table public.order_items             to anon, authenticated, service_role;
grant all on table public.orders                  to anon, authenticated, service_role;
grant all on table public.points_ledger           to anon, authenticated, service_role;
grant all on table public.product_option_values   to anon, authenticated, service_role;
grant all on table public.product_options         to anon, authenticated, service_role;
grant all on table public.products                to anon, authenticated, service_role;
grant all on table public.profiles                to anon, authenticated, service_role;
grant all on table public.promo_codes             to anon, authenticated, service_role;
grant all on table public.public_product_reviews  to anon, authenticated, service_role;
grant all on table public.referrals               to anon, authenticated, service_role;
grant all on table public.related_products        to anon, authenticated, service_role;
grant all on table public.reviews                 to anon, authenticated, service_role;
grant all on table public.settings                to anon, authenticated, service_role;
grant all on table public.stock_notifications     to anon, authenticated, service_role;
grant all on table public.wishlist_shares         to anon, authenticated, service_role;
grant all on table public.wishlists               to anon, authenticated, service_role;

-- ---- reviews: the one narrowing that is actually in force -----------------
-- The revoke must stay for the column list below to mean anything.

revoke select on public.reviews from anon, authenticated;

grant select (
  product_id,
  rating,
  body,
  author_name,
  created_at,
  image_paths
) on public.reviews to anon, authenticated;

-- ---- products: column list present but INERT ------------------------------
-- There is no `revoke select` here because there is none on live. The
-- table-level GRANT ALL above wins and cost_cents is readable. Excluded from
-- the list: cost_cents, auto_disabled.

grant select (
  id,
  slug,
  name,
  short_description,
  long_description,
  base_price_cents,
  category,
  image_paths,
  is_available,
  is_best_seller,
  is_recommended,
  allergens,
  dietary_tags,
  ingredients,
  storage_info,
  serving_info,
  lead_time_days_override,
  sort_order,
  created_at,
  updated_at,
  stock_count,
  available_from,
  flavour_box,
  personalisation_label,
  personalisation_allow_photo
) on public.products to anon, authenticated;

-- ---- settings: column list present but INERT ------------------------------
-- Excluded from the list: pickup_address_private. Readable anyway, as above.

grant select (
  id,
  delivery_fee_cents,
  free_delivery_min_cents,
  min_order_cents,
  lead_time_days,
  daily_order_cap,
  blackout_dates,
  pickup_location_public,
  time_windows,
  payment_methods_enabled,
  contact_email,
  contact_phone,
  whatsapp,
  instagram,
  updated_at,
  points_per_dollar,
  point_value_cents,
  referral_referrer_points,
  referral_referee_points,
  feature_rewards,
  feature_wishlist,
  feature_reviews,
  feature_promos,
  feature_gifting,
  feature_referrals,
  feature_build_a_box,
  feature_bundles,
  feature_spend_gift,
  feature_back_in_stock,
  feature_photo_reviews,
  feature_cart_sharing,
  feature_wishlist_sharing,
  feature_instagram_feed,
  feature_birthday_rewards,
  feature_abandoned_cart,
  feature_structured_notes,
  per_window_cap,
  daily_cutoff_time,
  free_gift_threshold_cents,
  free_gift_product_id,
  birthday_reward_points,
  abandoned_after_hours,
  note_prompts,
  feature_order_changes,
  feature_newsletter,
  feature_drops,
  feature_dietary_prefs,
  low_stock_threshold,
  mascot_message,
  feature_occasion_reminders
) on public.settings to anon, authenticated;

-- ---- Function EXECUTE grants ----------------------------------------------
--
-- CREATE FUNCTION grants EXECUTE to PUBLIC by default, and this project's
-- default privileges in `public` additionally grant EXECUTE to anon and
-- authenticated. The three server-only functions therefore need an explicit
-- revoke, or they would be callable straight from the REST API by anyone.

revoke all on function public.create_order_with_items(jsonb, jsonb, integer, integer) from public, anon, authenticated;
revoke all on function public.add_items_to_order(uuid, jsonb, integer) from public, anon, authenticated;
revoke all on function public.adjust_product_stock(uuid, integer) from public, anon, authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;

grant execute on function public.create_order_with_items(jsonb, jsonb, integer, integer) to service_role;
grant execute on function public.add_items_to_order(uuid, jsonb, integer) to service_role;
grant execute on function public.adjust_product_stock(uuid, integer) to service_role;
grant execute on function public.handle_new_user() to service_role;

-- The two token lookups are meant to be callable by an unauthenticated visitor
-- holding a tracking or gift token. On live these retain the default PUBLIC
-- EXECUTE in addition to the explicit role grants; both are reproduced.

grant execute on function public.get_order_by_token(text) to public, anon, authenticated, service_role;
grant execute on function public.get_gift_by_token(text) to public, anon, authenticated, service_role;


-- ---- Default privileges ----------------------------------------------------
--
-- These are catalog objects in their own right (pg_default_acl) and they were
-- missing from this baseline even though the note above depends on them. They
-- decide what happens to objects created AFTER this file runs, which is the
-- whole future of the schema.
--
-- Live holds three entries for role postgres in schema public, reproduced
-- exactly below. There is a matching set owned by supabase_admin that the
-- platform installs on every project; it is not reproduced here because only
-- supabase_admin can create it and it already exists wherever this file would
-- sensibly run.
--
-- Consequence if these are left out: a new table created later gets no grant to
-- anon or authenticated and is invisible to the REST API, while the same table
-- on live would be exposed. That is a divergence that shows up as a confusing
-- 404 rather than as an error, so it is worth pinning down.
--
-- Note the direction of the risk: this grants ALL on future tables to anon and
-- authenticated. That is the stock Supabase posture and RLS is the real gate,
-- but it does mean a new table is open until its RLS is enabled.

alter default privileges for role postgres in schema public
  grant all on tables to postgres, anon, authenticated, service_role;

alter default privileges for role postgres in schema public
  grant all on functions to postgres, anon, authenticated, service_role;

alter default privileges for role postgres in schema public
  grant all on sequences to postgres, anon, authenticated, service_role;


-- ============================================================================
-- END OF BASELINE
-- ============================================================================
