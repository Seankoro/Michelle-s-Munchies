# Postal-code delivery fees (distance-based) — Design

## Goal

Replace the single flat delivery fee with a fee that depends on the driving
distance from the kitchen to the delivery address. Exact distance comes from
OneMap; a persistent cache and an offline sector-centre estimate keep it robust
when OneMap is slow or down. All pricing is server-authoritative and
owner-configurable.

## Current state

- Pickup is always free. Delivery is one flat fee (`settings.delivery_fee_cents`),
  waived when the subtotal is at or above `settings.free_delivery_min_cents`.
- The 6-digit Singapore postal code is already collected and validated at
  checkout (`/^\d{6}$/`) but is not used for pricing.
- The fee is computed by `computeDeliveryFeeCents(subtotal, fulfillment, settings)`
  in `src/lib/order.ts`, called client-side in checkout and re-computed
  authoritatively server-side in `placeOrder` (`src/app/checkout/actions.ts`).

## Decisions locked during brainstorming

- Distance-based, not named zones or the 5-region model (too coarse: Choa Chu
  Kang and Yishun must differ).
- Actual **driving** distance via OneMap (not straight-line) for the primary path.
- **No maximum distance**; the farthest tier applies to anything beyond it.
- OneMap is **free** (Singapore Land Authority); cost is not a factor.
- Fallback chain, best to last resort: cache -> OneMap -> sector-centre -> flat.
- A Supabase table caches OneMap results, serving double duty (fewer calls +
  the best offline fallback for already-seen addresses).
- Keep the sector-centre step for the rare "new address AND OneMap down" case,
  to preserve distance fairness.

## Fee resolution (server-authoritative)

A server-only function resolves the delivery distance in km for a
`(deliveryPostal, kitchenPostal)` pair, trying each step until one succeeds:

1. **Cache hit** — the pair is already in the Supabase cache. Return the cached
   driving distance. Works even when OneMap is down.
2. **Cache miss + OneMap up** — geocode the address, route from the kitchen to
   get driving distance, **write the result to the cache**, return it.
3. **Cache miss + OneMap down** — take the delivery postal code's first two
   digits (its sector), look up that sector's centre coordinates in a bundled
   static table, compute straight-line distance from the kitchen's cached
   coordinates, scale it by the self-calibrating road factor (see below) to
   approximate driving, return it.
4. **Sector unknown** (rare for a valid 6-digit code) — return null.

The fee is then:

- `fulfillment === "pickup"` -> 0.
- subtotal >= `free_delivery_min_cents` -> 0 (the existing threshold still wins,
  regardless of distance).
- distance km resolved -> map to the matching distance tier -> tier fee.
- distance unresolved (step 4) -> the last-resort flat fee.

## Configuration (Admin -> Settings -> Delivery)

- **Kitchen postal code** — the routing origin. On save it is geocoded once and
  its coordinates stored (needed by the offline sector-centre step).
- **Distance tiers** — an editable ordered list of `{ upToKm, feeCents }` bands.
  The last band applies to anything farther (no cutoff).
- **Last-resort flat fee** — reuse the existing `delivery_fee_cents`.
- **Free-delivery threshold** — reuse the existing `free_delivery_min_cents`.

The feature is **off until configured**: if the tiers list is empty or the
kitchen postal or its coordinates are missing, delivery uses the current flat
`delivery_fee_cents`, so behaviour is unchanged until the owner sets it up. No
separate feature flag is needed.

## OneMap integration (`src/lib/onemap.ts`, server-only)

- Credentials in env, server-only: `ONEMAP_EMAIL`, `ONEMAP_PASSWORD`.
- `getToken()` — authenticate, cache the access token in memory, refresh on
  expiry (token lifetime is a few days).
- `geocodePostal(postal)` — Search API, returns `{ lat, lng }` or null.
- `driveDistanceMeters(from, to)` — Routing API (`routeType=drive`), returns
  meters or null.
- Every call is wrapped so a network error, non-200, rate-limit, or empty result
  returns null rather than throwing, letting the resolver fall through.
- Exact endpoint paths, auth shape, and rate limits will be verified against the
  current OneMap docs during the implementation plan.

## Supabase cache

- New table `delivery_distance_cache`:
  - `delivery_postal text`, `kitchen_postal text`, `distance_m integer` (OneMap
    driving distance), `delivery_lat double precision`,
    `delivery_lng double precision` (the geocoded address, so the straight-line
    distance and the road factor can be derived from cached rows),
    `resolved_at timestamptz default now()`.
  - Unique on `(delivery_postal, kitchen_postal)`.
- RLS enabled, no policies — service-role only, matching the other internal
  tables. All reads and writes happen server-side in the resolver.
- Keyed by `(delivery_postal, kitchen_postal)`, so moving the kitchen simply
  produces new rows; old-origin rows are ignored and can be cleared.
- The kitchen's own geocoded coordinates are stored in `settings`
  (`kitchen_lat`, `kitchen_lng`), populated when the kitchen postal is saved, so
  the sector-centre step needs no OneMap call.

## Sector-centre fallback data

- `src/lib/sg-postal-sectors.ts` — a static map of the ~60 in-use postal sectors
  (first two digits) to representative centre coordinates. Small and static.
- Sourcing: geocode one representative postal code per sector once (via OneMap or
  a public dataset) and bundle the result. Confirmed during implementation.

## Road-distance factor (self-calibrating)

The sector-centre step needs a factor to turn straight-line distance into an
approximate driving distance. It is measured, not guessed: cached rows hold both
the true OneMap driving distance and the geocoded coordinates, so the factor is
the **median of `driving_distance / straight_line_distance`** across cached
addresses for the current kitchen. It defaults to **1.4** (not 1.3, which
underestimates in Singapore where reservoirs, nature reserves, and the coast
force detours) until there are enough samples, so it starts conservative and
becomes Singapore-specific as orders accumulate. This only affects the rare
offline-new-address estimate.

## Checkout UX and safety

- Client no longer computes the delivery fee locally for delivery orders. When a
  valid 6-digit postal code is entered (debounced), checkout calls a new server
  action `estimateDeliveryFee(postalCode, subtotalCents)` that runs the resolver
  and returns the fee. The summary shows a brief loading state, then the fee.
- On placement, `placeOrder` recomputes the fee through the same resolver and
  never trusts the client value, so a tampered fee cannot get through (extends
  the existing server-authoritative pricing).

## Data-model summary

- `settings`: add `kitchen_postal text`, `kitchen_lat double precision`,
  `kitchen_lng double precision`, `delivery_distance_tiers jsonb` (array of
  `{ upToKm, feeCents }`). Keep `delivery_fee_cents` (last-resort) and
  `free_delivery_min_cents` (threshold).
- New table `delivery_distance_cache` (above).
- New static module `src/lib/sg-postal-sectors.ts`.
- New server modules `src/lib/onemap.ts` and a resolver (e.g.
  `src/lib/delivery-distance.ts`).

## Error handling

Every step degrades to the next, so checkout never blocks on OneMap. Invalid
postal codes are already rejected by the existing 6-digit check before the
resolver runs.

## Security

- OneMap credentials and all OneMap calls are server-only.
- The resolver runs server-side; the cache table is service-role only.
- No new public data surface. The `estimateDeliveryFee` server action takes only
  a postal code and subtotal and returns a fee.

## Testing

- Unit tests for the resolver's fee mapping: distance -> tier (band boundaries,
  beyond-last-band), pickup, free-delivery-threshold waiver, last-resort path.
- Unit test the sector derivation (first two digits) and sector-centre distance
  math.
- Cache hit vs miss behaviour with OneMap mocked (success writes cache; failure
  falls to sector-centre; both never throw).

## To verify during implementation

- Exact OneMap endpoints, auth flow, token TTL, and rate limits.
- Source of the sector-centre coordinate table.
- The sample threshold before the road factor switches from the 1.4 default to
  the measured median.

## Out of scope

- "Self-collect near MRT X" pickup points (a separate backlog item).
- The named-zone / 5-region pricing model (replaced by distance tiers).
- The other Singapore-gated features (PayNow-as-hero, WhatsApp notifications).
