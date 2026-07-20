import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { geocodePostal, driveDistanceMeters, __resetTokenForTests } from "@/lib/onemap";

const okJson = (body: unknown) => ({ ok: true, json: async () => body }) as Response;

beforeEach(() => {
  process.env.ONEMAP_EMAIL = "x@example.com";
  process.env.ONEMAP_PASSWORD = "pw";
  __resetTokenForTests();
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
