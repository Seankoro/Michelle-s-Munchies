-- Delivery-zone config is server-only: the kitchen coordinates are effectively
-- the home baker's address, and the settings table is publicly readable. Move
-- the config off settings into a service-role-only table. The storefront gets
-- delivery fees through a server action, so it never needs this config client-side.
alter table public.settings
  drop column if exists kitchen_postal,
  drop column if exists kitchen_lat,
  drop column if exists kitchen_lng,
  drop column if exists delivery_distance_tiers;

create table if not exists public.delivery_config (
  id integer primary key default 1,
  kitchen_postal text,
  kitchen_lat double precision,
  kitchen_lng double precision,
  distance_tiers jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  constraint delivery_config_single_row check (id = 1)
);
insert into public.delivery_config (id) values (1) on conflict (id) do nothing;

alter table public.delivery_config enable row level security;
-- No policies: service-role only.
