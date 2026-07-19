import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildFulfillmentLabel,
  buildOrderWhatsAppUrl,
  getShopWhatsAppNumber,
} from "@/lib/whatsapp";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getShopWhatsAppNumber", () => {
  it("strips everything but digits", () => {
    vi.stubEnv("WHATSAPP_NUMBER", "+65 9123-4567");
    expect(getShopWhatsAppNumber()).toBe("6591234567");
  });

  it("is empty when unset, so callers can render fallbacks", () => {
    vi.stubEnv("WHATSAPP_NUMBER", "");
    expect(getShopWhatsAppNumber()).toBe("");
  });
});

describe("buildFulfillmentLabel", () => {
  it("joins date and window with a separator", () => {
    expect(buildFulfillmentLabel("pickup", "Tue, 21 Jul 2026", "Morning (9am–12pm)")).toBe(
      "Pickup on Tue, 21 Jul 2026 · Morning (9am–12pm)",
    );
  });

  it("omits the window cleanly when missing", () => {
    expect(buildFulfillmentLabel("delivery", "Tue, 21 Jul 2026", null)).toBe(
      "Delivery on Tue, 21 Jul 2026",
    );
  });
});

describe("buildOrderWhatsAppUrl", () => {
  const order = {
    orderNumber: "MM-260721-TEST",
    items: [
      { quantity: 2, name: "Original Basque", options: ['6 inch (for 4 pax)'] },
      { quantity: 1, name: "Sea Salt Dark Choco", options: [] },
    ],
    totalLabel: "S$52.00",
    customerName: "Alex Tan",
    fulfillmentLabel: "Pickup on Tue, 21 Jul 2026 · Morning (9am–12pm)",
  };

  it("targets the right number and fully encodes the message", () => {
    const url = buildOrderWhatsAppUrl("6591234567", order);
    expect(url.startsWith("https://wa.me/6591234567?text=")).toBe(true);

    const text = decodeURIComponent(url.split("?text=")[1]);
    expect(text).toContain("MM-260721-TEST");
    expect(text).toContain("2x Original Basque (6 inch (for 4 pax))");
    expect(text).toContain("1x Sea Salt Dark Choco");
    expect(text).toContain("Total: S$52.00");
    expect(text).toContain("Name: Alex Tan");
    expect(text).toContain("Pickup on Tue, 21 Jul 2026 · Morning (9am–12pm)");
  });

  it("survives names that would break an unencoded URL", () => {
    const url = buildOrderWhatsAppUrl("6591234567", {
      ...order,
      customerName: "A&B ?Family #1",
    });
    // The raw special characters must not appear unencoded in the query string.
    const query = url.split("?text=")[1];
    expect(query).not.toContain("&");
    expect(query).not.toContain("#");
    expect(decodeURIComponent(query)).toContain("Name: A&B ?Family #1");
  });
});
