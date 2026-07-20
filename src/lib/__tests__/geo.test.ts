import { describe, it, expect } from "vitest";
import { haversineKm } from "@/lib/geo";

describe("haversineKm", () => {
  it("is zero for the same point", () => {
    expect(haversineKm({ lat: 1.3, lng: 103.8 }, { lat: 1.3, lng: 103.8 })).toBe(0);
  });
  it("matches a known Singapore distance within 3 percent", () => {
    // City Hall to Jurong East, about 12.8 km straight line.
    const km = haversineKm({ lat: 1.2931, lng: 103.8520 }, { lat: 1.3329, lng: 103.7436 });
    expect(km).toBeGreaterThan(12.4);
    expect(km).toBeLessThan(13.3);
  });
});
