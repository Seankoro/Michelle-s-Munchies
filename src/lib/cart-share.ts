// Pure, client-safe encode/decode for a shareable cart link. The payload carries
// no identity — only product ids, chosen option labels, and quantities — and is
// re-resolved + re-priced server-side, so it is display-only and tamper-safe.

export type SharedLine = {
  productId: string;
  valueLabels: string[];
  quantity: number;
};

/** Compact JSON for the `?c=` query param (caller URL-encodes it). */
export function encodeSharedCart(lines: SharedLine[]): string {
  return JSON.stringify(
    lines.map((l) => ({ p: l.productId, o: l.valueLabels, q: l.quantity })),
  );
}

/** Defensive parse of a shared-cart param (already URL-decoded by the framework). */
export function decodeSharedCart(raw: string): SharedLine[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .slice(0, 50)
      .map((x) => ({
        productId: String(x?.p ?? ""),
        valueLabels: Array.isArray(x?.o) ? x.o.map(String) : [],
        quantity: Math.max(1, Math.min(99, Number(x?.q) || 1)),
      }))
      .filter((l) => l.productId);
  } catch {
    return [];
  }
}
