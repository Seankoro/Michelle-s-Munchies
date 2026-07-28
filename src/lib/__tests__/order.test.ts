import { describe, expect, it } from "vitest";
import {
  computeDeliveryFeeCents,
  earliestFulfillmentDate,
  formatLongDate,
  toISODate,
} from "@/lib/order";

describe("computeDeliveryFeeCents", () => {
  const settings = { deliveryFeeCents: 800, freeDeliveryMinCents: 5000 };

  it("pickup is always free", () => {
    expect(computeDeliveryFeeCents(100, "pickup", settings)).toBe(0);
    expect(computeDeliveryFeeCents(999_999, "pickup", settings)).toBe(0);
  });

  it("delivery below the threshold pays the flat fee", () => {
    expect(computeDeliveryFeeCents(4999, "delivery", settings)).toBe(800);
  });

  it("delivery at or above the threshold is free", () => {
    expect(computeDeliveryFeeCents(5000, "delivery", settings)).toBe(0);
    expect(computeDeliveryFeeCents(9000, "delivery", settings)).toBe(0);
  });

  it("no threshold means the fee always applies to delivery", () => {
    expect(
      computeDeliveryFeeCents(999_999, "delivery", {
        deliveryFeeCents: 800,
        freeDeliveryMinCents: null,
      }),
    ).toBe(800);
  });

  it("a zero threshold is disabled, not free for everyone", () => {
    expect(
      computeDeliveryFeeCents(999_999, "delivery", {
        deliveryFeeCents: 800,
        freeDeliveryMinCents: 0,
      }),
    ).toBe(800);
  });
});

describe("earliestFulfillmentDate", () => {
  // A fixed local morning: 17 Jul 2026, 10:00.
  const morning = new Date(2026, 6, 17, 10, 0);

  it("adds the lead time in days", () => {
    expect(earliestFulfillmentDate(2, morning, null)).toBe("2026-07-19");
    expect(earliestFulfillmentDate(0, morning, null)).toBe("2026-07-17");
  });

  it("before the cutoff the date is unchanged", () => {
    expect(earliestFulfillmentDate(2, morning, "14:00")).toBe("2026-07-19");
  });

  it("at or past the cutoff the date moves one day later", () => {
    const atCutoff = new Date(2026, 6, 17, 14, 0);
    const evening = new Date(2026, 6, 17, 18, 30);
    expect(earliestFulfillmentDate(2, atCutoff, "14:00")).toBe("2026-07-20");
    expect(earliestFulfillmentDate(2, evening, "14:00")).toBe("2026-07-20");
  });

  it("rolls across month ends correctly", () => {
    const endOfMonth = new Date(2026, 6, 30, 18, 0);
    expect(earliestFulfillmentDate(2, endOfMonth, "14:00")).toBe("2026-08-02");
  });

  it("ignores a malformed cutoff", () => {
    expect(earliestFulfillmentDate(2, morning, "not-a-time")).toBe("2026-07-19");
  });
});

describe("toISODate", () => {
  it("formats local dates without UTC drift", () => {
    expect(toISODate(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(toISODate(new Date(2026, 11, 31, 23, 59))).toBe("2026-12-31");
  });
});

describe("formatLongDate", () => {
  it("renders a friendly Singapore-style date", () => {
    expect(formatLongDate("2026-06-04")).toMatch(/Thu.*4 Jun 2026/);
  });
});
