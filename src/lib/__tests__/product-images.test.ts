import { describe, expect, it } from "vitest";
import { cardImageUrl } from "@/lib/product-images";

const labelled = "https://x.supabase.co/storage/v1/object/public/products/tiramisu-labelled.jpg";
const angled = "https://x.supabase.co/storage/v1/object/public/products/tiramisu-angled.jpg";

describe("cardImageUrl", () => {
  it("uses the chosen card photo when it is one of the product's photos", () => {
    expect(cardImageUrl({ imageUrls: [labelled, angled], cardImageUrl: angled })).toBe(angled);
  });

  it("falls back to the first photo when no card photo is chosen", () => {
    expect(cardImageUrl({ imageUrls: [labelled, angled], cardImageUrl: null })).toBe(labelled);
    expect(cardImageUrl({ imageUrls: [labelled, angled] })).toBe(labelled);
  });

  it("ignores a card photo that was removed from the product", () => {
    expect(cardImageUrl({ imageUrls: [labelled], cardImageUrl: angled })).toBe(labelled);
  });

  it("returns undefined when the product has no photos, so the placeholder shows", () => {
    expect(cardImageUrl({ imageUrls: [], cardImageUrl: angled })).toBeUndefined();
    expect(cardImageUrl({})).toBeUndefined();
  });
});
