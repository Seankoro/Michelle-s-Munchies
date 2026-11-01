import { describe, expect, it } from "vitest";
import { rankCartSuggestions } from "@/lib/cart-suggestions";
import type { Product } from "@/lib/types";

function product(id: string, category: string, price: number, extra: Partial<Product> = {}): Product {
  return {
    id,
    slug: id,
    name: id,
    shortDescription: "",
    longDescription: "",
    basePriceCents: price,
    category,
    isAvailable: true,
    isBestSeller: false,
    isRecommended: false,
    allergens: [],
    dietaryTags: [],
    options: [],
    ...extra,
  };
}

const oreo = product("oreo", "Cheesecake", 3600);
const original = product("original", "Cheesecake", 3300);
const chocoChip = product("choco-chip", "Mini Cookies", 1200);
const seaSalt = product("sea-salt", "Mini Cookies", 1300);
const tiramisu = product("tiramisu", "Cake Tins", 1600);

const ids = (products: Product[]) => products.map((p) => p.id);

describe("rankCartSuggestions", () => {
  it("never offers what is already in the cart", () => {
    const ranked = rankCartSuggestions([oreo, chocoChip, tiramisu], ["oreo"]);
    expect(ids(ranked)).not.toContain("oreo");
  });

  it("puts other categories before the cart's own, then cheaper first", () => {
    const ranked = rankCartSuggestions([oreo, original, tiramisu, seaSalt, chocoChip], ["oreo"]);
    expect(ids(ranked)).toEqual(["choco-chip", "sea-salt", "tiramisu", "original"]);
  });

  it("puts best sellers, then recommended, ahead of cheaper treats", () => {
    const pool = [
      oreo,
      chocoChip,
      { ...tiramisu, isRecommended: true },
      { ...seaSalt, isBestSeller: true },
    ];
    expect(ids(rankCartSuggestions(pool, ["oreo"]))).toEqual(["sea-salt", "tiramisu", "choco-chip"]);
  });

  it("puts treats bought before first of all", () => {
    const pool = [oreo, { ...chocoChip, isBestSeller: true }, original];
    expect(ids(rankCartSuggestions(pool, ["oreo"], ["original"]))).toEqual([
      "original",
      "choco-chip",
    ]);
  });

  it("stops at the limit", () => {
    const pool = [oreo, original, chocoChip, seaSalt, tiramisu];
    expect(rankCartSuggestions(pool, [], [], 2)).toHaveLength(2);
  });
});
