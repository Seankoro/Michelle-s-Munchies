import "server-only";

/**
 * The shop's WhatsApp number, digits only, from WHATSAPP_NUMBER. Empty string
 * when unset, callers must render a fallback rather than nothing, since the
 * WhatsApp handoff is how orders get confirmed and paid.
 */
export function getShopWhatsAppNumber(): string {
  return (process.env.WHATSAPP_NUMBER ?? "").replace(/[^\d]/g, "");
}

/**
 * "Pickup on Tue, 21 Jul 2026 · Morning (9am–12pm)". Built here so the
 * tracking page and the order email can never phrase it differently.
 */
export function buildFulfillmentLabel(
  type: "pickup" | "delivery",
  dateLabel: string,
  timeWindow: string | null | undefined,
): string {
  return `${type === "pickup" ? "Pickup" : "Delivery"} on ${dateLabel}${timeWindow ? ` · ${timeWindow}` : ""}`;
}

export type WhatsAppOrderInfo = {
  orderNumber: string;
  items: { quantity: number; name: string; options: string[] }[];
  totalLabel: string;
  customerName: string;
  /** e.g. "Pickup on 21 July 2026 · Morning (9am–12pm)" */
  fulfillmentLabel: string;
};

/**
 * Pre-filled wa.me link a customer taps to confirm their order. Shared by the
 * tracking page and the order email so the message stays identical.
 */
export function buildOrderWhatsAppUrl(number: string, order: WhatsAppOrderInfo): string {
  const lines = [
    `Hi Michelle's Munchies! I'd like to confirm my order ${order.orderNumber}.`,
    "",
    ...order.items.map(
      (item) =>
        `${item.quantity}x ${item.name}` +
        (item.options.length > 0 ? ` (${item.options.join(", ")})` : ""),
    ),
    `Total: ${order.totalLabel}`,
    "",
    `Name: ${order.customerName}`,
    order.fulfillmentLabel,
  ];
  return `https://wa.me/${number}?text=${encodeURIComponent(lines.join("\n"))}`;
}
