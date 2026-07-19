import { describe, expect, it } from "vitest";
import { decodeSharedCart, encodeSharedCart } from "@/lib/cart-share";

describe("shared cart encode/decode", () => {
  it("round-trips lines intact, keeping option names", () => {
    const lines = [
      {
        productId: "abc",
        selections: [{ optionName: "Size", valueLabel: "6 inch" }],
        quantity: 2,
        name: "Basque",
      },
      { productId: "def", selections: [], quantity: 1 },
    ];
    expect(decodeSharedCart(encodeSharedCart(lines))).toEqual(lines);
  });

  it("still decodes older label-only links", () => {
    const [line] = decodeSharedCart(JSON.stringify([{ p: "abc", o: ["6 inch"], q: 1 }]));
    expect(line.selections).toEqual([{ optionName: "", valueLabel: "6 inch" }]);
  });

  it("clamps quantities into 1..99", () => {
    const [low, high] = decodeSharedCart(
      JSON.stringify([
        { p: "a", o: [], q: 0 },
        { p: "b", o: [], q: 500 },
      ]),
    );
    expect(low.quantity).toBe(1);
    expect(high.quantity).toBe(99);
  });

  it("caps the number of lines at 50", () => {
    const many = JSON.stringify(
      Array.from({ length: 80 }, (_, i) => ({ p: `p${i}`, o: [], q: 1 })),
    );
    expect(decodeSharedCart(many)).toHaveLength(50);
  });

  it("returns an empty cart for garbage input", () => {
    expect(decodeSharedCart("not json")).toEqual([]);
    expect(decodeSharedCart('{"an":"object"}')).toEqual([]);
    expect(decodeSharedCart('[{"o":[],"q":1}]')).toEqual([]); // missing product id
  });
});
