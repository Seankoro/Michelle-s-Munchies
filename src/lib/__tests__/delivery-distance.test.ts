import { describe, it, expect, vi, beforeEach } from "vitest";

type CacheRow = {
  delivery_postal: string;
  kitchen_postal: string;
  distance_m: number;
  delivery_lat: number | null;
  delivery_lng: number | null;
};

// Mock the Supabase admin client with an in-memory cache table. The cache
// read chains `.select().eq().eq().maybeSingle()`, while the road-factor
// query chains `.select().eq()` and is awaited directly, so the object
// returned from the first `eq()` needs to be both chainable (a second
// `.eq().maybeSingle()`) and thenable (awaitable to `{ data: rows }`).
const rows: CacheRow[] = [];
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: rows[0] ?? null }) }),
          then: (resolve: (result: { data: CacheRow[] }) => void) => resolve({ data: rows }),
        }),
      }),
      upsert: async (r: CacheRow) => { rows.push(r); return { error: null }; },
    }),
  }),
}));
vi.mock("@/lib/onemap", () => ({
  geocodePostal: vi.fn(),
  driveDistanceMeters: vi.fn(),
}));

import { resolveDeliveryDistanceKm, medianOf } from "@/lib/delivery-distance";
import { geocodePostal, driveDistanceMeters } from "@/lib/onemap";

const kitchen = { postal: "500001", lat: 1.30, lng: 103.85 };
beforeEach(() => { rows.length = 0; vi.clearAllMocks(); });

describe("resolveDeliveryDistanceKm", () => {
  it("uses OneMap when available and writes the cache", async () => {
    vi.mocked(geocodePostal).mockResolvedValue({ lat: 1.31, lng: 103.86 });
    vi.mocked(driveDistanceMeters).mockResolvedValue(4200);
    const km = await resolveDeliveryDistanceKm("049213", kitchen);
    expect(km).toBeCloseTo(4.2, 1);
    expect(rows.length).toBe(1);
  });
  it("falls back to the sector centre when OneMap fails", async () => {
    vi.mocked(geocodePostal).mockResolvedValue(null);
    vi.mocked(driveDistanceMeters).mockResolvedValue(null);
    const km = await resolveDeliveryDistanceKm("689123", kitchen); // known sector 68
    expect(km).not.toBeNull();
    expect(km!).toBeGreaterThan(0);
  });
  it("returns null when OneMap fails and the sector is unknown", async () => {
    vi.mocked(geocodePostal).mockResolvedValue(null);
    vi.mocked(driveDistanceMeters).mockResolvedValue(null);
    expect(await resolveDeliveryDistanceKm("000000", kitchen)).toBeNull();
  });
});

describe("medianOf", () => {
  it("returns null for an empty list", () => {
    expect(medianOf([])).toBeNull();
  });
  it("returns the middle value for an odd-length list", () => {
    expect(medianOf([3, 1, 2])).toBe(2);
  });
  it("returns the mean of the two middle values for an even-length list", () => {
    expect(medianOf([1, 2, 3, 4])).toBe(2.5);
  });
});
