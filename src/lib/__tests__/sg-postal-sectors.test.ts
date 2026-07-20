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
