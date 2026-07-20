import { describe, it, expect, vi, beforeEach } from "vitest";

let stored: Record<string, unknown>;
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: stored }) }) }),
      update: (patch: Record<string, unknown>) => ({
        eq: async () => {
          Object.assign(stored, patch);
          return { error: null };
        },
      }),
    }),
  }),
}));

import { fetchDeliveryConfig, updateDeliveryConfig } from "@/lib/delivery-config";

beforeEach(() => {
  stored = {
    id: 1,
    kitchen_postal: "500001",
    kitchen_lat: 1.3,
    kitchen_lng: 103.8,
    distance_tiers: [{ upToKm: 5, feeCents: 600 }],
  };
});

describe("delivery-config", () => {
  it("reads the row into camelCase", async () => {
    const c = await fetchDeliveryConfig();
    expect(c.kitchenPostal).toBe("500001");
    expect(c.kitchenLat).toBe(1.3);
    expect(c.tiers).toEqual([{ upToKm: 5, feeCents: 600 }]);
  });
  it("drops malformed tier rows", async () => {
    stored.distance_tiers = [{ upToKm: 5, feeCents: 600 }, { bad: true }];
    expect((await fetchDeliveryConfig()).tiers).toEqual([{ upToKm: 5, feeCents: 600 }]);
  });
  it("writes a patch back as snake_case", async () => {
    await updateDeliveryConfig({ kitchenPostal: "520520", tiers: [] });
    expect(stored.kitchen_postal).toBe("520520");
    expect(stored.distance_tiers).toEqual([]);
  });
});
