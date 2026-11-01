import type { Product } from "@/lib/types";

/**
 * The photo to show wherever a product appears small: the menu card, cart line,
 * quick-pick, box builder, wishlist share and link previews. The product page
 * gallery shows every photo in order instead.
 *
 * Uses the admin's chosen card photo when it is still one of the product's
 * photos, otherwise the first photo, otherwise undefined for the placeholder.
 */
export function cardImageUrl(product: Pick<Product, "imageUrls" | "cardImageUrl">): string | undefined {
  const urls = product.imageUrls ?? [];
  if (product.cardImageUrl && urls.includes(product.cardImageUrl)) return product.cardImageUrl;
  return urls[0];
}
