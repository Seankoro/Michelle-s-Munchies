import { isComingSoon } from "@/lib/launch";
import type { Product, ProductOption } from "@/lib/types";

/**
 * Assorted boxes (Assorted Mini Cookies and the like) take their flavours from
 * the other products in their category instead of a hand-typed option list.
 * A typed list kept a flavour on sale after its product was deleted, because
 * nothing tied the two together. Deriving the list means deleting a product
 * removes the flavour, selling one out marks it out of stock, and adding one
 * offers it, all without touching the assorted product.
 */

/** The product fields a flavour is built from. */
export type FlavourSource = Pick<
  Product,
  | "id"
  | "name"
  | "category"
  | "isAvailable"
  | "stockCount"
  | "comingSoon"
  | "availableFrom"
  | "flavourBox"
>;

/** Marks the generated flavour group, so the admin editor never saves it back as a typed list. */
export const ASSORTED_OPTION_PREFIX = "assorted:";

export function isAssortedOption(option: ProductOption): boolean {
  return option.id.startsWith(ASSORTED_OPTION_PREFIX);
}

/** A flavour can't go in a box when its product is switched off or out of stock. */
export function isFlavourSoldOut(source: FlavourSource): boolean {
  if (!source.isAvailable) return true;
  return source.stockCount != null && source.stockCount <= 0;
}

/**
 * The flavours for an assorted product: every other product in its category,
 * in menu order. Other assorted products are skipped, so an Assorted box never
 * offers another Assorted box as a flavour, and so is anything still Coming
 * soon, which joins the list by itself once it launches.
 */
export function assortedFlavours(product: Product, sources: FlavourSource[], now = new Date()) {
  return sources
    .filter(
      (s) =>
        s.category === product.category &&
        s.id !== product.id &&
        !s.flavourBox &&
        !isComingSoon(s, now),
    )
    .map((s) => ({
      id: s.id,
      label: s.name.trim(),
      priceDeltaCents: 0,
      isAvailable: !isFlavourSoldOut(s),
    }));
}

/**
 * Swap an assorted product's flavour group for the derived one. Any stored
 * group of the same name is dropped, since that is the stale typed list.
 * Products without a build-your-own box come back unchanged.
 */
export function withAssortedFlavours<T extends Product>(
  product: T,
  sources: FlavourSource[],
  now = new Date(),
): T {
  const config = product.flavourBox;
  if (!config) return product;
  const flavours: ProductOption = {
    id: `${ASSORTED_OPTION_PREFIX}${product.id}`,
    name: config.flavourOption,
    required: true,
    values: assortedFlavours(product, sources, now),
  };
  const others = product.options.filter((option) => option.name !== config.flavourOption);
  return { ...product, options: [flavours, ...others] };
}

/**
 * False for an assorted product with no flavour a customer can pick, either
 * because every product in its category was deleted or because all of them
 * are out of stock. The storefront leaves those off the menu entirely.
 */
export function hasPickableFlavour(product: Product): boolean {
  const config = product.flavourBox;
  if (!config) return true;
  const option = product.options.find((o) => o.name === config.flavourOption);
  return (option?.values ?? []).some((value) => value.isAvailable !== false);
}
