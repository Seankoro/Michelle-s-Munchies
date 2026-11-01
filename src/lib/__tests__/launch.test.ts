import { describe, expect, it } from "vitest";
import {
  comingSoonLabel,
  fromSgtParts,
  isComingSoon,
  isTeaser,
  LAUNCH_TIMES,
  toSgtParts,
} from "@/lib/launch";

const now = new Date("2026-11-01T02:00:00Z");
const future = "2026-12-12T02:00:00.000Z"; // 12 Dec, 10:00 am in Singapore
const past = "2026-10-01T02:00:00.000Z";

describe("isComingSoon", () => {
  it("is true for a teaser with no launch date", () => {
    expect(isComingSoon({ comingSoon: true, availableFrom: null }, now)).toBe(true);
  });

  it("is true while the launch date is still ahead", () => {
    expect(isComingSoon({ comingSoon: true, availableFrom: future }, now)).toBe(true);
  });

  it("goes on sale by itself once the launch date passes", () => {
    expect(isComingSoon({ comingSoon: true, availableFrom: past }, now)).toBe(false);
  });

  it("ignores a kept launch date while Coming soon is off", () => {
    expect(isComingSoon({ comingSoon: false, availableFrom: future }, now)).toBe(false);
  });
});

describe("isTeaser", () => {
  it("is only a Coming soon product without a date", () => {
    expect(isTeaser({ comingSoon: true, availableFrom: null })).toBe(true);
    expect(isTeaser({ comingSoon: true, availableFrom: future })).toBe(false);
    expect(isTeaser({ comingSoon: false, availableFrom: null })).toBe(false);
  });
});

describe("comingSoonLabel", () => {
  it("names the Singapore launch day when there is one", () => {
    expect(comingSoonLabel({ comingSoon: true, availableFrom: future })).toBe("Coming 12 Dec");
    // 11 Dec, 5:00 pm UTC is already 12 Dec, 1:00 am in Singapore
    expect(
      comingSoonLabel({ comingSoon: true, availableFrom: "2026-12-11T17:00:00.000Z" }),
    ).toBe("Coming 12 Dec");
    expect(comingSoonLabel({ comingSoon: true, availableFrom: null })).toBe("Coming soon");
  });
});

describe("Singapore date and time fields", () => {
  it("round-trips a launch time", () => {
    expect(toSgtParts(future)).toEqual({ date: "2026-12-12", time: "10:00" });
    expect(fromSgtParts("2026-12-12", "10:00")).toBe(future);
  });

  it("offers half-hour times from 7:00 am to 10:00 pm", () => {
    expect(LAUNCH_TIMES[0]).toEqual({ value: "07:00", label: "7:00 am" });
    expect(LAUNCH_TIMES.at(-1)).toEqual({ value: "22:00", label: "10:00 pm" });
    expect(LAUNCH_TIMES.find((t) => t.value === "12:30")?.label).toBe("12:30 pm");
  });
});
