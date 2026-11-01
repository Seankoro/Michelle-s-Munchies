import type { Product } from "@/lib/types";

/** How many treats the cart's suggestion row offers at most. */
export const CART_SUGGESTION_LIMIT = 8;

/**
 * Orders the cart's "Add a little something" row. Client-safe, so the row can
 * rerank the moment the cart changes without another server round trip.
 *
 * Nothing already in the cart is offered. Of the rest, in this order:
 * 1. treats this customer bought before ("buy again"),
 * 2. best sellers, then Michelle's recommended picks,
 * 3. other categories before the cart's own, since a cookie suits a cake order
 *    better than a second cake,
 * 4. cheaper first, as an add-on is a small extra,
 * and menu order breaks any tie that is left.
 *
 * The pool is expected to hold only treats on sale now; fetchSuggestionPool
 * already drops sold-out and coming-soon ones.
 */
export function rankCartSuggestions(
  pool: Product[],
  cartProductIds: Iterable<string>,
  boughtIds: Iterable<string> = [],
  limit = CART_SUGGESTION_LIMIT,
): Product[] {
  const inCart = new Set(cartProductIds);
  const bought = new Set(boughtIds);
  const cartCategories = new Set(pool.filter((p) => inCart.has(p.id)).map((p) => p.category));

  const keys = (p: Product, index: number) => [
    bought.has(p.id) ? 0 : 1,
    p.isBestSeller ? 0 : p.isRecommended ? 1 : 2,
    cartCategories.has(p.category) ? 1 : 0,
    p.basePriceCents,
    index,
  ];

  return pool
    .map((product, index) => ({ product, key: keys(product, index) }))
    .filter(({ product }) => !inCart.has(product.id))
    .sort((a, b) => {
      for (let i = 0; i < a.key.length; i++) {
        if (a.key[i] !== b.key[i]) return a.key[i] - b.key[i];
      }
      return 0;
    })
    .slice(0, limit)
    .map(({ product }) => product);
}
