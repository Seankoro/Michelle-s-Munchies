// Pure, client-safe encoding and decoding for a shareable cart link. The payload
// carries no identity, only product ids, chosen option labels, and quantities, and
// is re-resolved and re-priced server-side, so it is display-only and tamper-safe.

export type SharedSelection = { optionName: string; valueLabel: string };
export type SharedLine = {
  productId: string;
  /** Option name + chosen label, so re-resolution can't pick the wrong option
   *  when two options share a value label (e.g. Sponge/Frosting both "Vanilla"). */
  selections: SharedSelection[];
  quantity: number;
  /** Product name snapshot, so a line that can't be re-resolved is still named. */
  name?: string;
};

/** Compact JSON for the `?c=` query param, which the caller URL-encodes. */
export function encodeSharedCart(lines: SharedLine[]): string {
  return JSON.stringify(
    lines.map((l) => ({
      p: l.productId,
      o: l.selections.map((s) => [s.optionName, s.valueLabel]),
      q: l.quantity,
      n: l.name,
    })),
  );
}

/** Defensive parse of a shared-cart param, already URL-decoded by the framework. */
export function decodeSharedCart(raw: string): SharedLine[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .slice(0, 50)
      .map((x) => ({
        productId: String(x?.p ?? ""),
        // Accept the current [name, label] pairs and older label-only links.
        selections: Array.isArray(x?.o)
          ? x.o.map((s: unknown) =>
              Array.isArray(s)
                ? { optionName: String(s[0] ?? ""), valueLabel: String(s[1] ?? "") }
                : { optionName: "", valueLabel: String(s) },
            )
          : [],
        quantity: Math.max(1, Math.min(99, Number(x?.q) || 1)),
        name: x?.n ? String(x.n) : undefined,
      }))
      .filter((l) => l.productId);
  } catch {
    return [];
  }
}
