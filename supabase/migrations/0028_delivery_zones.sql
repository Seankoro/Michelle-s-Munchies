-- Distance-based delivery pricing: kitchen origin, tiers, and a distance cache.
alter table public.settings
  add column if not exists kitchen_postal text,
  add column if not exists kitchen_lat double precision,
  add column if not exists kitchen_lng double precision,
  add column if not exists delivery_distance_tiers jsonb not null default '[]'::jsonb;

create table if not exists public.delivery_distance_cache (
  delivery_postal text not null,
  kitchen_postal text not null,
  distance_m integer not null,
  delivery_lat double precision,
  delivery_lng double precision,
  resolved_at timestamptz not null default now(),
  primary key (delivery_postal, kitchen_postal)
);

alter table public.delivery_distance_cache enable row level security;
-- No policies: service-role only, matching the other internal tables.
