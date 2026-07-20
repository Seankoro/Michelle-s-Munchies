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
