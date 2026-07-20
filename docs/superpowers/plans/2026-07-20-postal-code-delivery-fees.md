# Postal-code delivery fees Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Charge delivery by driving distance from the kitchen to the address, using OneMap, with a Supabase distance cache and an offline sector-centre fallback.

**Architecture:** A server-only resolver turns a delivery postal code into a distance in km by trying, in order, a Supabase cache, a live OneMap route, then a bundled sector-centre estimate. Distance maps to owner-configured tiers. Everything runs server-side and is enforced in `placeOrder`; the checkout UI asks a server action for the live fee.

**Tech Stack:** Next.js 15 App Router, TypeScript (strict), Supabase (Postgres, migrations via mcp `apply_migration`), vitest, OneMap REST API.

## Global Constraints

- Money is stored and passed as integer **cents**.
- Delivery pricing is **server-authoritative**: `placeOrder` never trusts a client-sent fee.
- New internal tables have **RLS enabled with no policies** (service-role only). All OneMap calls and cache access are server-only.
- Commits are **plain voice** (no em dashes, semicolons, prose colons, or parentheticals) and authored by the repo owner with **no `Co-Authored-By: Claude` trailer**.
- Tests use **vitest** (`npm test`), config is `vitest.config.mts`, `server-only` is stubbed via `src/test/server-only-stub.ts`.
- OneMap host is `https://www.onemap.gov.sg`. Credentials `ONEMAP_EMAIL` / `ONEMAP_PASSWORD` are server-only env.
- The feature is **off until configured**: empty tiers or missing kitchen coordinates means delivery uses the existing flat `delivery_fee_cents`.

---

## File Structure

- Create `supabase/migrations/0028_delivery_zones.sql` — settings columns + `delivery_distance_cache` table.
- Create `src/lib/geo.ts` — pure `haversineKm`.
- Create `src/lib/sg-postal-sectors.ts` — static sector-centre table + `sectorCentre(postal)`.
- Create `src/lib/delivery-fee.ts` — pure `feeForDistanceKm` + `computeZonedDeliveryFeeCents`.
- Create `src/lib/onemap.ts` — server-only OneMap client.
- Create `src/lib/delivery-distance.ts` — server-only resolver + cache + road-factor calibration.
- Modify `src/lib/settings.ts` — new settings fields, SELECT, mapping, defaults.
- Modify `src/lib/admin-db.ts` — persist the new settings fields.
- Modify `src/app/checkout/actions.ts` — `estimateDeliveryFeeAction` + enforce in `placeOrder`.
- Modify `src/app/checkout/page.tsx` — call the action on a valid postal code.
- Modify `src/app/admin/(panel)/settings/page.tsx` — kitchen postal + tiers editor.
- Modify `.env.local.example` — document the OneMap env vars.
- Tests: `src/lib/__tests__/geo.test.ts`, `sg-postal-sectors.test.ts`, `delivery-fee.test.ts`, `onemap.test.ts`, `delivery-distance.test.ts`.

---

## Task 1: Database migration

**Files:**
- Create: `supabase/migrations/0028_delivery_zones.sql`

**Interfaces:**
- Produces: `settings` columns `kitchen_postal text`, `kitchen_lat double precision`, `kitchen_lng double precision`, `delivery_distance_tiers jsonb default '[]'::jsonb`; table `delivery_distance_cache(delivery_postal text, kitchen_postal text, distance_m integer, delivery_lat double precision, delivery_lng double precision, resolved_at timestamptz default now())` unique on `(delivery_postal, kitchen_postal)`.

- [ ] **Step 1: Write the migration file**

```sql
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
```

- [ ] **Step 2: Apply the migration**

Apply via the Supabase mcp `apply_migration` tool with name `0028_delivery_zones` and the SQL above. Then confirm with `execute_sql`:

```sql
select column_name from information_schema.columns
where table_schema='public' and table_name='settings' and column_name like 'kitchen%';
select relrowsecurity from pg_class where oid='public.delivery_distance_cache'::regclass;
```
Expected: three kitchen columns listed, and `relrowsecurity = true`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0028_delivery_zones.sql
git commit -m "Add delivery-zone settings columns and distance cache table"
```

---

## Task 2: Settings wiring

**Files:**
- Modify: `src/lib/settings.ts`
- Modify: `src/lib/admin-db.ts`

**Interfaces:**
- Produces: `StoreSettings` gains `kitchenPostal: string | null`, `kitchenLat: number | null`, `kitchenLng: number | null`, `deliveryDistanceTiers: DistanceTier[]`. `DistanceTier = { upToKm: number; feeCents: number }` exported from `src/lib/delivery-fee.ts` (Task 4) — until Task 4 exists, define it inline in settings and re-export. To avoid a forward dependency, define `DistanceTier` in `src/lib/delivery-fee.ts` first if doing tasks out of order; here import it.
- Consumes: nothing new.

- [ ] **Step 1: Read the current shapes**

Read `src/lib/settings.ts` for `StoreSettings`, `SETTINGS_SELECT`, `rowToStoreSettings`, `DEFAULTS`, and the `SettingsRow` type. Read `src/lib/admin-db.ts` for the settings update column mapping (search `delivery_fee_cents`).

- [ ] **Step 2: Add the fields to the types and mapping**

In `src/lib/settings.ts`: add to `StoreSettings`:

```ts
kitchenPostal: string | null;
kitchenLat: number | null;
kitchenLng: number | null;
deliveryDistanceTiers: import("@/lib/delivery-fee").DistanceTier[];
```

Add to the `SettingsRow` type: `kitchen_postal: string | null; kitchen_lat: number | null; kitchen_lng: number | null; delivery_distance_tiers: unknown;`

Append the columns to `SETTINGS_SELECT` (the string of column names): `, kitchen_postal, kitchen_lat, kitchen_lng, delivery_distance_tiers`.

In `rowToStoreSettings`, add:

```ts
kitchenPostal: row.kitchen_postal ?? null,
kitchenLat: row.kitchen_lat ?? null,
kitchenLng: row.kitchen_lng ?? null,
deliveryDistanceTiers: Array.isArray(row.delivery_distance_tiers)
  ? (row.delivery_distance_tiers as DistanceTier[]).filter(
      (t) => t && typeof t.upToKm === "number" && typeof t.feeCents === "number",
    )
  : [],
```

Add to `DEFAULTS` / `mockSettings`: `kitchenPostal: null, kitchenLat: null, kitchenLng: null, deliveryDistanceTiers: []`. Add `import type { DistanceTier } from "@/lib/delivery-fee";`.

- [ ] **Step 3: Persist them from admin**

In `src/lib/admin-db.ts`, in the settings update mapping (near `delivery_fee_cents`), add for the patch:

```ts
if (patch.kitchenPostal !== undefined) columns.kitchen_postal = patch.kitchenPostal;
if (patch.kitchenLat !== undefined) columns.kitchen_lat = patch.kitchenLat;
if (patch.kitchenLng !== undefined) columns.kitchen_lng = patch.kitchenLng;
if (patch.deliveryDistanceTiers !== undefined)
  columns.delivery_distance_tiers = patch.deliveryDistanceTiers;
```
Match the existing patch/column style in that function exactly (it may use a different variable name than `columns`).

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: passes once Task 4 defines `DistanceTier`. If doing Task 2 before Task 4, create `src/lib/delivery-fee.ts` with just `export type DistanceTier = { upToKm: number; feeCents: number };` first.

- [ ] **Step 5: Commit**

```bash
git add src/lib/settings.ts src/lib/admin-db.ts src/lib/delivery-fee.ts
git commit -m "Load and persist the delivery-zone settings fields"
```

---

## Task 3: Geo math and sector-centre data

**Files:**
- Create: `src/lib/geo.ts`
- Create: `src/lib/sg-postal-sectors.ts`
- Test: `src/lib/__tests__/geo.test.ts`, `src/lib/__tests__/sg-postal-sectors.test.ts`

**Interfaces:**
- Produces: `haversineKm(a: LatLng, b: LatLng): number` where `LatLng = { lat: number; lng: number }`; `sectorCentre(postal: string): LatLng | null`.

- [ ] **Step 1: Write the failing geo test**

```ts
// src/lib/__tests__/geo.test.ts
import { describe, it, expect } from "vitest";
import { haversineKm } from "@/lib/geo";

describe("haversineKm", () => {
  it("is zero for the same point", () => {
    expect(haversineKm({ lat: 1.3, lng: 103.8 }, { lat: 1.3, lng: 103.8 })).toBe(0);
  });
  it("matches a known Singapore distance within 3 percent", () => {
    // City Hall to Jurong East, about 15.2 km straight line.
    const km = haversineKm({ lat: 1.2931, lng: 103.8520 }, { lat: 1.3329, lng: 103.7436 });
    expect(km).toBeGreaterThan(14.7);
    expect(km).toBeLessThan(15.7);
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npm test -- geo`
Expected: FAIL, cannot import `haversineKm`.

- [ ] **Step 3: Implement geo.ts**

```ts
// src/lib/geo.ts
export type LatLng = { lat: number; lng: number };

/** Great-circle distance in km between two WGS84 points. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371; // km
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}
```

- [ ] **Step 4: Write the failing sector test**

```ts
// src/lib/__tests__/sg-postal-sectors.test.ts
import { describe, it, expect } from "vitest";
import { sectorCentre } from "@/lib/sg-postal-sectors";

describe("sectorCentre", () => {
  it("resolves a valid 6-digit code to its sector centre", () => {
    const c = sectorCentre("049213"); // sector 04, Raffles Place area
    expect(c).not.toBeNull();
    expect(c!.lat).toBeGreaterThan(1.2);
    expect(c!.lat).toBeLessThan(1.5);
  });
  it("returns different centres for far-apart sectors", () => {
    const cck = sectorCentre("689123"); // sector 68, Choa Chu Kang / west
    const yishun = sectorCentre("760123"); // sector 76, Yishun / north
    expect(cck).not.toBeNull();
    expect(yishun).not.toBeNull();
    expect(cck).not.toEqual(yishun);
  });
  it("returns null for an unknown sector", () => {
    expect(sectorCentre("000000")).toBeNull();
  });
});
```

- [ ] **Step 5: Run it, verify it fails**

Run: `npm test -- sg-postal-sectors`
Expected: FAIL, cannot import `sectorCentre`.

- [ ] **Step 6: Implement sg-postal-sectors.ts**

Build the `SECTOR_CENTRES` table by geocoding one representative postal code per in-use sector once via OneMap (a throwaway script using `geocodePostal` from Task 5), then paste the results as a literal. Structure:

```ts
// src/lib/sg-postal-sectors.ts
import type { LatLng } from "@/lib/geo";

/** First-two-digits postal sector -> representative centre (WGS84).
 *  Built once from OneMap geocodes of a representative postal per sector. */
const SECTOR_CENTRES: Record<string, LatLng> = {
  "01": { lat: 1.2811, lng: 103.8506 },
  "02": { lat: 1.2792, lng: 103.8480 },
  // ... one entry per in-use sector (about 60 rows) ...
  "68": { lat: 1.3854, lng: 103.7443 },
  "76": { lat: 1.4166, lng: 103.8380 },
  "80": { lat: 1.3538, lng: 103.9450 },
};

/** Centre of the sector a 6-digit postal code belongs to, or null. */
export function sectorCentre(postal: string): LatLng | null {
  if (!/^\d{6}$/.test(postal)) return null;
  return SECTOR_CENTRES[postal.slice(0, 2)] ?? null;
}
```
The two sectors asserted in the test (`68`, `76`) must be present with distinct, roughly correct coordinates. Populate the rest before shipping; a missing sector correctly returns null and degrades to the last-resort flat fee.

- [ ] **Step 7: Run both test files, verify they pass**

Run: `npm test -- geo sg-postal-sectors`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/geo.ts src/lib/sg-postal-sectors.ts src/lib/__tests__/geo.test.ts src/lib/__tests__/sg-postal-sectors.test.ts
git commit -m "Add geo distance helper and Singapore sector-centre lookup"
```

---

## Task 4: Fee mapping (pure)

**Files:**
- Create/extend: `src/lib/delivery-fee.ts`
- Test: `src/lib/__tests__/delivery-fee.test.ts`

**Interfaces:**
- Produces: `type DistanceTier = { upToKm: number; feeCents: number }`; `feeForDistanceKm(km: number | null, tiers: DistanceTier[], fallbackFeeCents: number): number`; `computeZonedDeliveryFeeCents(input): number` where `input = { fulfillment: "pickup" | "delivery"; subtotalCents: number; distanceKm: number | null; tiers: DistanceTier[]; fallbackFeeCents: number; freeDeliveryMinCents: number | null }`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/__tests__/delivery-fee.test.ts
import { describe, it, expect } from "vitest";
import { feeForDistanceKm, computeZonedDeliveryFeeCents } from "@/lib/delivery-fee";

const tiers = [
  { upToKm: 5, feeCents: 600 },
  { upToKm: 10, feeCents: 900 },
  { upToKm: 15, feeCents: 1200 },
];

describe("feeForDistanceKm", () => {
  it("picks the first band whose upToKm is not exceeded", () => {
    expect(feeForDistanceKm(3, tiers, 1500)).toBe(600);
    expect(feeForDistanceKm(5, tiers, 1500)).toBe(600);
    expect(feeForDistanceKm(7.5, tiers, 1500)).toBe(900);
  });
  it("uses the last band for anything beyond it (no cutoff)", () => {
    expect(feeForDistanceKm(40, tiers, 1500)).toBe(1200);
  });
  it("uses the fallback fee when distance is unresolved", () => {
    expect(feeForDistanceKm(null, tiers, 1500)).toBe(1500);
  });
  it("uses the fallback fee when no tiers are configured", () => {
    expect(feeForDistanceKm(7, [], 1500)).toBe(1500);
  });
});

describe("computeZonedDeliveryFeeCents", () => {
  const base = { tiers, fallbackFeeCents: 1500, freeDeliveryMinCents: 8000 };
  it("is free for pickup", () => {
    expect(
      computeZonedDeliveryFeeCents({ ...base, fulfillment: "pickup", subtotalCents: 2000, distanceKm: 12 }),
    ).toBe(0);
  });
  it("is free above the delivery threshold regardless of distance", () => {
    expect(
      computeZonedDeliveryFeeCents({ ...base, fulfillment: "delivery", subtotalCents: 8000, distanceKm: 12 }),
    ).toBe(0);
  });
  it("charges the tier fee for a delivery under the threshold", () => {
    expect(
      computeZonedDeliveryFeeCents({ ...base, fulfillment: "delivery", subtotalCents: 3000, distanceKm: 12 }),
    ).toBe(1200);
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npm test -- delivery-fee`
Expected: FAIL, functions not defined.

- [ ] **Step 3: Implement delivery-fee.ts**

```ts
// src/lib/delivery-fee.ts
export type DistanceTier = { upToKm: number; feeCents: number };

/** Fee for a resolved distance. Ordered tiers, last band covers anything
 *  beyond it. A null distance or empty tiers use the fallback flat fee. */
export function feeForDistanceKm(
  km: number | null,
  tiers: DistanceTier[],
  fallbackFeeCents: number,
): number {
  if (km == null || tiers.length === 0) return fallbackFeeCents;
  const sorted = [...tiers].sort((a, b) => a.upToKm - b.upToKm);
  const band = sorted.find((t) => km <= t.upToKm);
  return band ? band.feeCents : sorted[sorted.length - 1].feeCents;
}

export function computeZonedDeliveryFeeCents(input: {
  fulfillment: "pickup" | "delivery";
  subtotalCents: number;
  distanceKm: number | null;
  tiers: DistanceTier[];
  fallbackFeeCents: number;
  freeDeliveryMinCents: number | null;
}): number {
  if (input.fulfillment === "pickup") return 0;
  if (input.freeDeliveryMinCents != null && input.subtotalCents >= input.freeDeliveryMinCents) {
    return 0;
  }
  return feeForDistanceKm(input.distanceKm, input.tiers, input.fallbackFeeCents);
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `npm test -- delivery-fee`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/delivery-fee.ts src/lib/__tests__/delivery-fee.test.ts
git commit -m "Add distance-tier delivery fee mapping"
```

---

## Task 5: OneMap client

**Files:**
- Create: `src/lib/onemap.ts`
- Test: `src/lib/__tests__/onemap.test.ts`

**Interfaces:**
- Consumes: `LatLng` from `src/lib/geo.ts`.
- Produces: `geocodePostal(postal: string): Promise<LatLng | null>`; `driveDistanceMeters(from: LatLng, to: LatLng): Promise<number | null>`. Both return null on any failure and never throw.

- [ ] **Step 1: Write the failing test (mock global fetch)**

```ts
// src/lib/__tests__/onemap.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { geocodePostal, driveDistanceMeters } from "@/lib/onemap";

const okJson = (body: unknown) => ({ ok: true, json: async () => body }) as Response;

beforeEach(() => {
  process.env.ONEMAP_EMAIL = "x@example.com";
  process.env.ONEMAP_PASSWORD = "pw";
});
afterEach(() => vi.restoreAllMocks());

describe("geocodePostal", () => {
  it("returns lat/lng from the search result", async () => {
    vi.spyOn(global, "fetch")
      .mockResolvedValueOnce(okJson({ access_token: "t", expiry_timestamp: "9999999999" }))
      .mockResolvedValueOnce(okJson({ found: 1, results: [{ LATITUDE: "1.3", LONGITUDE: "103.8" }] }));
    expect(await geocodePostal("049213")).toEqual({ lat: 1.3, lng: 103.8 });
  });
  it("returns null when nothing is found", async () => {
    vi.spyOn(global, "fetch")
      .mockResolvedValueOnce(okJson({ access_token: "t", expiry_timestamp: "9999999999" }))
      .mockResolvedValueOnce(okJson({ found: 0, results: [] }));
    expect(await geocodePostal("000000")).toBeNull();
  });
  it("returns null on a network error", async () => {
    vi.spyOn(global, "fetch").mockRejectedValue(new Error("down"));
    expect(await geocodePostal("049213")).toBeNull();
  });
});

describe("driveDistanceMeters", () => {
  it("returns route_summary.total_distance", async () => {
    vi.spyOn(global, "fetch")
      .mockResolvedValueOnce(okJson({ access_token: "t", expiry_timestamp: "9999999999" }))
      .mockResolvedValueOnce(okJson({ route_summary: { total_distance: 995 } }));
    expect(await driveDistanceMeters({ lat: 1.3, lng: 103.8 }, { lat: 1.31, lng: 103.81 })).toBe(995);
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npm test -- onemap`
Expected: FAIL, functions not defined.

- [ ] **Step 3: Implement onemap.ts**

```ts
// src/lib/onemap.ts
import "server-only";
import type { LatLng } from "@/lib/geo";

const BASE = "https://www.onemap.gov.sg";
let cachedToken: { token: string; expiresAt: number } | null = null;

async function getToken(): Promise<string | null> {
  const email = process.env.ONEMAP_EMAIL;
  const password = process.env.ONEMAP_PASSWORD;
  if (!email || !password) return null;
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.token;
  try {
    const res = await fetch(`${BASE}/api/auth/post/getToken`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { access_token?: string; expiry_timestamp?: string };
    if (!data.access_token) return null;
    const expiresAt = data.expiry_timestamp
      ? Number(data.expiry_timestamp) * 1000
      : Date.now() + 2 * 24 * 60 * 60 * 1000;
    cachedToken = { token: data.access_token, expiresAt };
    return cachedToken.token;
  } catch {
    return null;
  }
}

export async function geocodePostal(postal: string): Promise<LatLng | null> {
  const token = await getToken();
  if (!token) return null;
  try {
    const url = `${BASE}/api/common/elastic/search?searchVal=${encodeURIComponent(postal)}&returnGeom=Y&getAddrDetails=Y&pageNum=1`;
    const res = await fetch(url, { headers: { Authorization: token } });
    if (!res.ok) return null;
    const data = (await res.json()) as { results?: Array<{ LATITUDE?: string; LONGITUDE?: string }> };
    const first = data.results?.[0];
    if (!first?.LATITUDE || !first?.LONGITUDE) return null;
    const lat = Number(first.LATITUDE);
    const lng = Number(first.LONGITUDE);
    if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
    return { lat, lng };
  } catch {
    return null;
  }
}

export async function driveDistanceMeters(from: LatLng, to: LatLng): Promise<number | null> {
  const token = await getToken();
  if (!token) return null;
  try {
    const url = `${BASE}/api/public/routingsvc/route?start=${from.lat},${from.lng}&end=${to.lat},${to.lng}&routeType=drive`;
    const res = await fetch(url, { headers: { Authorization: token } });
    if (!res.ok) return null;
    const data = (await res.json()) as { route_summary?: { total_distance?: number } };
    const m = data.route_summary?.total_distance;
    return typeof m === "number" ? m : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `npm test -- onemap`
Expected: PASS. (The test mocks `fetch`; the resolver in Task 6 also resets `cachedToken` between tests by re-importing or by the module boundary. If token caching leaks across tests, expose a `__resetTokenForTests()` and call it in `beforeEach`.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/onemap.ts src/lib/__tests__/onemap.test.ts
git commit -m "Add server-only OneMap geocode and driving-distance client"
```

---

## Task 6: Distance resolver, cache, and road factor

**Files:**
- Create: `src/lib/delivery-distance.ts`
- Test: `src/lib/__tests__/delivery-distance.test.ts`

**Interfaces:**
- Consumes: `geocodePostal`, `driveDistanceMeters` (Task 5); `haversineKm` (Task 3); `sectorCentre` (Task 3); the admin Supabase client (`createAdminClient` from `@/lib/supabase/admin`).
- Produces: `resolveDeliveryDistanceKm(deliveryPostal: string, kitchen: { postal: string; lat: number; lng: number }): Promise<number | null>` and `roadFactor(): Promise<number>`. Both server-only.

- [ ] **Step 1: Write the failing test (mock onemap + the admin client)**

```ts
// src/lib/__tests__/delivery-distance.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Supabase admin client with an in-memory cache table.
const rows: any[] = [];
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: rows[0] ?? null }) }) }) }),
      upsert: async (r: any) => { rows.push(r); return { error: null }; },
    }),
  }),
}));
vi.mock("@/lib/onemap", () => ({
  geocodePostal: vi.fn(),
  driveDistanceMeters: vi.fn(),
}));

import { resolveDeliveryDistanceKm } from "@/lib/delivery-distance";
import { geocodePostal, driveDistanceMeters } from "@/lib/onemap";

const kitchen = { postal: "500001", lat: 1.30, lng: 103.85 };
beforeEach(() => { rows.length = 0; vi.clearAllMocks(); });

describe("resolveDeliveryDistanceKm", () => {
  it("uses OneMap when available and writes the cache", async () => {
    (geocodePostal as any).mockResolvedValue({ lat: 1.31, lng: 103.86 });
    (driveDistanceMeters as any).mockResolvedValue(4200);
    const km = await resolveDeliveryDistanceKm("049213", kitchen);
    expect(km).toBeCloseTo(4.2, 1);
    expect(rows.length).toBe(1);
  });
  it("falls back to the sector centre when OneMap fails", async () => {
    (geocodePostal as any).mockResolvedValue(null);
    (driveDistanceMeters as any).mockResolvedValue(null);
    const km = await resolveDeliveryDistanceKm("689123", kitchen); // known sector 68
    expect(km).not.toBeNull();
    expect(km!).toBeGreaterThan(0);
  });
  it("returns null when OneMap fails and the sector is unknown", async () => {
    (geocodePostal as any).mockResolvedValue(null);
    (driveDistanceMeters as any).mockResolvedValue(null);
    expect(await resolveDeliveryDistanceKm("000000", kitchen)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npm test -- delivery-distance`
Expected: FAIL, `resolveDeliveryDistanceKm` not defined.

- [ ] **Step 3: Implement delivery-distance.ts**

```ts
// src/lib/delivery-distance.ts
import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { geocodePostal, driveDistanceMeters } from "@/lib/onemap";
import { haversineKm, type LatLng } from "@/lib/geo";
import { sectorCentre } from "@/lib/sg-postal-sectors";

const DEFAULT_ROAD_FACTOR = 1.4;

type CacheRow = {
  delivery_postal: string;
  kitchen_postal: string;
  distance_m: number;
  delivery_lat: number | null;
  delivery_lng: number | null;
};

async function readCache(deliveryPostal: string, kitchenPostal: string): Promise<CacheRow | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("delivery_distance_cache")
    .select("delivery_postal, kitchen_postal, distance_m, delivery_lat, delivery_lng")
    .eq("delivery_postal", deliveryPostal)
    .eq("kitchen_postal", kitchenPostal)
    .maybeSingle();
  return (data as CacheRow) ?? null;
}

async function writeCache(row: CacheRow): Promise<void> {
  const admin = createAdminClient();
  await admin.from("delivery_distance_cache").upsert(row);
}

/** Median driving/straight-line ratio across cached rows, or the default. */
export async function roadFactor(): Promise<number> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("delivery_distance_cache")
    .select("distance_m, delivery_lat, delivery_lng, kitchen_postal");
  // The kitchen coords are needed; callers pass them, but for calibration we
  // only have the delivery coords here, so ratios are computed in resolve and
  // this helper stays a thin default unless enough rows carry both. Keep the
  // default until a follow-up wires kitchen coords into the cache rows.
  if (!data || data.length < 20) return DEFAULT_ROAD_FACTOR;
  return DEFAULT_ROAD_FACTOR;
}

/** Distance in km from the kitchen to a delivery postal code, or null. */
export async function resolveDeliveryDistanceKm(
  deliveryPostal: string,
  kitchen: { postal: string; lat: number; lng: number },
): Promise<number | null> {
  const cached = await readCache(deliveryPostal, kitchen.postal);
  if (cached) return cached.distance_m / 1000;

  const dest = await geocodePostal(deliveryPostal);
  if (dest) {
    const meters = await driveDistanceMeters({ lat: kitchen.lat, lng: kitchen.lng }, dest);
    if (meters != null) {
      await writeCache({
        delivery_postal: deliveryPostal,
        kitchen_postal: kitchen.postal,
        distance_m: Math.round(meters),
        delivery_lat: dest.lat,
        delivery_lng: dest.lng,
      });
      return meters / 1000;
    }
  }

  const centre: LatLng | null = sectorCentre(deliveryPostal);
  if (centre) {
    const factor = await roadFactor();
    return haversineKm({ lat: kitchen.lat, lng: kitchen.lng }, centre) * factor;
  }
  return null;
}
```
Note: the `roadFactor` self-calibration reduces to the default here; the design's median-from-real-data is a follow-up once cache rows have accumulated. The cache already stores `delivery_lat/lng`, so no schema change is needed to finish it later. Keep this documented in the code comment (above) so it is not mistaken for complete.

- [ ] **Step 4: Run it, verify it passes**

Run: `npm test -- delivery-distance`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/delivery-distance.ts src/lib/__tests__/delivery-distance.test.ts
git commit -m "Add cached distance resolver with sector-centre fallback"
```

---

## Task 7: Checkout server action and enforcement

**Files:**
- Modify: `src/app/checkout/actions.ts`

**Interfaces:**
- Consumes: `resolveDeliveryDistanceKm` (Task 6), `computeZonedDeliveryFeeCents` (Task 4), `fetchStoreSettings` (existing).
- Produces: `estimateDeliveryFeeAction(postalCode: string, subtotalCents: number): Promise<{ feeCents: number }>`.

- [ ] **Step 1: Read the current placeOrder fee logic**

Read `src/app/checkout/actions.ts` where it calls `computeDeliveryFeeCents` and where the delivery address/postal is available. Note the settings object it already fetches.

- [ ] **Step 2: Add a shared resolver helper**

In `src/app/checkout/actions.ts`, add a server helper used by both the action and `placeOrder`:

```ts
async function resolveDeliveryFeeCents(
  fulfillment: "pickup" | "delivery",
  subtotalCents: number,
  postalCode: string | undefined,
  settings: Awaited<ReturnType<typeof fetchStoreSettings>>,
): Promise<number> {
  const zonesReady =
    settings.deliveryDistanceTiers.length > 0 &&
    settings.kitchenPostal != null &&
    settings.kitchenLat != null &&
    settings.kitchenLng != null;
  if (fulfillment === "delivery" && zonesReady && postalCode && /^\d{6}$/.test(postalCode)) {
    const km = await resolveDeliveryDistanceKm(postalCode, {
      postal: settings.kitchenPostal!,
      lat: settings.kitchenLat!,
      lng: settings.kitchenLng!,
    });
    return computeZonedDeliveryFeeCents({
      fulfillment,
      subtotalCents,
      distanceKm: km,
      tiers: settings.deliveryDistanceTiers,
      fallbackFeeCents: settings.deliveryFeeCents,
      freeDeliveryMinCents: settings.freeDeliveryMinCents,
    });
  }
  // Not configured, or pickup: keep the existing flat behaviour.
  return computeDeliveryFeeCents(subtotalCents, fulfillment, settings);
}
```
Add the imports for `resolveDeliveryDistanceKm` and `computeZonedDeliveryFeeCents`.

- [ ] **Step 3: Add the public action**

```ts
export async function estimateDeliveryFeeAction(
  postalCode: string,
  subtotalCents: number,
): Promise<{ feeCents: number }> {
  if (!(await rateLimit("delivery-estimate", { limit: 30, windowMs: 5 * 60_000 }))) {
    return { feeCents: 0 };
  }
  const settings = await fetchStoreSettings();
  const feeCents = await resolveDeliveryFeeCents("delivery", subtotalCents, postalCode, settings);
  return { feeCents };
}
```
Match the existing `rateLimit` import/signature in the file.

- [ ] **Step 4: Enforce in placeOrder**

Replace the existing `computeDeliveryFeeCents(...)` call inside `placeOrder` with `await resolveDeliveryFeeCents(input.fulfillmentType, subtotalCents, input.address?.postalCode, settings)`, using the same subtotal and settings it already computed. The client-sent fee is still ignored.

- [ ] **Step 5: Typecheck and build**

Run: `npx tsc --noEmit && npm run build`
Expected: passes.

- [ ] **Step 6: Commit**

```bash
git add src/app/checkout/actions.ts
git commit -m "Resolve delivery fee by distance in checkout action and placeOrder"
```

---

## Task 8: Checkout UI

**Files:**
- Modify: `src/app/checkout/page.tsx`

**Interfaces:**
- Consumes: `estimateDeliveryFeeAction` (Task 7).

- [ ] **Step 1: Read the current fee display**

Read `src/app/checkout/page.tsx` for the `postalCode` state, the delivery-fee state used in the summary, and where `computeDeliveryFeeCents` (or the client settings) currently sets the fee.

- [ ] **Step 2: Fetch the fee when the postal code is valid**

Add an effect that, for delivery orders with a valid 6-digit postal code, calls the action (debounced ~500ms) and stores the result; while it is in flight show a small "calculating delivery..." note in the summary. Keep the existing flat fee as the immediate value until the estimate returns.

```tsx
useEffect(() => {
  if (fulfillment !== "delivery" || !/^\d{6}$/.test(postalCode)) return;
  let cancelled = false;
  const id = window.setTimeout(async () => {
    setDeliveryFeePending(true);
    try {
      const { feeCents } = await estimateDeliveryFeeAction(postalCode, subtotalCents);
      if (!cancelled) setDeliveryFeeCents(feeCents);
    } finally {
      if (!cancelled) setDeliveryFeePending(false);
    }
  }, 500);
  return () => { cancelled = true; window.clearTimeout(id); };
}, [postalCode, fulfillment, subtotalCents]);
```
Wire `deliveryFeeCents` / `deliveryFeePending` into the existing summary rows. Import `estimateDeliveryFeeAction`.

- [ ] **Step 3: Verify in the browser**

Run `npm start`, open `/checkout` with items in the cart, choose delivery, type a valid postal code, and confirm the delivery fee updates and the total recomputes. Confirm pickup shows free and an unconfigured store still shows the flat fee.

- [ ] **Step 4: Commit**

```bash
git add src/app/checkout/page.tsx
git commit -m "Show the distance-based delivery fee live at checkout"
```

---

## Task 9: Admin settings UI and env

**Files:**
- Modify: `src/app/admin/(panel)/settings/page.tsx`
- Modify: `.env.local.example`

**Interfaces:**
- Consumes: the settings fields from Task 2; `updateSettings` via `AdminStore` (existing).

- [ ] **Step 1: Add a Delivery zones section**

In the settings form, add inputs bound to the settings patch:
- Kitchen postal code (6-digit text). On save, if it changed, geocode it server-side and store `kitchenLat/kitchenLng` (extend the settings update path or a small server action `geocodeKitchenAction(postal)` that returns lat/lng for the client to include in the patch). Show "not located yet" if coords are missing.
- Distance tiers: a small editable list of rows `{ upToKm, feeCents }` with add/remove, saved as `deliveryDistanceTiers`. Reuse the compact input styles (`compactInputClass`) and the existing add/remove row pattern from the bundles admin page.

Keep the existing flat `delivery_fee_cents` field labelled as the fallback fee, and the free-delivery threshold as-is.

- [ ] **Step 2: Add the OneMap env vars to the example**

In `.env.local.example`, under a new comment block:

```
# OneMap (Singapore Land Authority), optional. Enables distance-based delivery
# fees. Free account at onemap.gov.sg. Without these, delivery uses the flat fee.
ONEMAP_EMAIL=
ONEMAP_PASSWORD=
```

- [ ] **Step 3: Verify**

Run `npm run build`, then in the running app set a kitchen postal + two tiers in admin, save, and confirm they persist (reload) and that checkout then prices by distance.

- [ ] **Step 4: Commit**

```bash
git add "src/app/admin/(panel)/settings/page.tsx" .env.local.example
git commit -m "Add delivery-zone admin controls and OneMap env docs"
```

---

## Self-Review

**Spec coverage:** resolution chain (Tasks 4/6), OneMap (5), cache (1/6), sector-centre (3/6), config in settings (2/9), server-authoritative placeOrder (7), checkout UX (8), env + security (9, service-role table in 1), tests (3/4/5/6). Covered. The self-calibrating road factor is scaffolded (cache stores the coords) but reduced to the 1.4 default in Task 6, with the median-from-data step explicitly deferred and documented in code — flagged here so it is a conscious follow-up, not a silent gap.

**Placeholder scan:** the sector table in Task 3 must be fully populated before shipping (the plan says so and the tested sectors are concrete). No other placeholders.

**Type consistency:** `DistanceTier`, `LatLng`, `resolveDeliveryDistanceKm`, `computeZonedDeliveryFeeCents`, `feeForDistanceKm`, `geocodePostal`, `driveDistanceMeters`, `estimateDeliveryFeeAction` are used with the same signatures across tasks.

## Follow-ups (out of this plan)

- Finish the self-calibrating road factor: compute the median `driving / straight-line` ratio from cache rows once enough have accumulated (the coords are already stored).
- Populate the full ~60-sector centre table.
