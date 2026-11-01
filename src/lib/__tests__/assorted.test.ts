import { describe, expect, it } from "vitest";
import {
  assortedFlavours,
  hasPickableFlavour,
  isAssortedOption,
  withAssortedFlavours,
} from "@/lib/assorted";
import type { Product } from "@/lib/types";

const now = new Date("2026-11-01T00:00:00Z");

function product(id: string, name: string, extra: Partial<Product> = {}): Product {
  return {
    id,
    slug: id,
    name,
    shortDescription: "",
    longDescription: "",
    basePriceCents: 1200,
    category: "Mini Cookies",
    isAvailable: true,
    isBestSeller: false,
    isRecommended: false,
    allergens: [],
    dietaryTags: [],
    options: [],
    ...extra,
  };
}

const assorted = product("assorted", "Assorted Mini Cookies", {
  flavourBox: {
    flavourOption: "Flavour",
    sizes: [{ label: "Jar", count: 2, priceCents: 1500 }],
  },
  options: [
    {
      id: "typed",
      name: "Flavour",
      required: true,
      values: [
        {
          id: "v1",
          label: "Macadamia White Choc",
          priceDeltaCents: 0,
          isAvailable: true,
        },
      ],
    },
  ],
});

describe("assortedFlavours", () => {
  it("lists the other products in the category, in order, and nothing else", () => {
    const sources = [
      product("a", "Choco Chip"),
      assorted,
      product("b", "Truffle Butter "),
      product("c", "Original Basque", { category: "Cheesecake" }),
    ];
    expect(assortedFlavours(assorted, sources, now).map((f) => f.label)).toEqual([
      "Choco Chip",
      "Truffle Butter",
    ]);
  });

  it("never offers another assorted box as a flavour", () => {
    const other = product("other", "Assorted Two", {
      flavourBox: assorted.flavourBox,
    });
    expect(assortedFlavours(assorted, [other, product("a", "Choco Chip")], now)).toHaveLength(1);
  });

  it("marks switched-off and out-of-stock products as out of stock", () => {
    const sources = [
      product("a", "Off", { isAvailable: false }),
      product("b", "Zero stock", { stockCount: 0 }),
      product("c", "Fine", { stockCount: 4 }),
    ];
    expect(assortedFlavours(assorted, sources, now).map((f) => f.isAvailable)).toEqual([
      false,
      false,
      true,
    ]);
  });

  it("leaves out Coming soon products until they launch", () => {
    const sources = [
      product("a", "Teaser", { comingSoon: true }),
      product("b", "Dated", { comingSoon: true, availableFrom: "2026-12-01T00:00:00Z" }),
      product("c", "Launched", { comingSoon: true, availableFrom: "2026-10-01T00:00:00Z" }),
    ];
    expect(assortedFlavours(assorted, sources, now).map((f) => f.label)).toEqual(["Launched"]);
  });
});

describe("withAssortedFlavours", () => {
  it("replaces the typed flavour list, so a deleted flavour is gone", () => {
    const derived = withAssortedFlavours(assorted, [product("a", "Choco Chip")], now);
    const flavour = derived.options.find((o) => o.name === "Flavour")!;
    expect(isAssortedOption(flavour)).toBe(true);
    expect(flavour.values.map((v) => v.label)).toEqual(["Choco Chip"]);
    expect(derived.options).toHaveLength(1);
  });

  it("leaves products without a build-your-own box alone", () => {
    const plain = product("a", "Choco Chip");
    expect(withAssortedFlavours(plain, [assorted], now)).toBe(plain);
  });
});

describe("hasPickableFlavour", () => {
  it("is false once every flavour is deleted", () => {
    expect(hasPickableFlavour(withAssortedFlavours(assorted, [], now))).toBe(false);
  });

  it("is false when every flavour is out of stock", () => {
    const sources = [product("a", "Choco Chip", { isAvailable: false })];
    expect(hasPickableFlavour(withAssortedFlavours(assorted, sources, now))).toBe(false);
  });

  it("is true while at least one flavour can be picked", () => {
    const sources = [product("a", "Off", { isAvailable: false }), product("b", "Choco Chip")];
    expect(hasPickableFlavour(withAssortedFlavours(assorted, sources, now))).toBe(true);
  });
});
