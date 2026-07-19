/**
 * The canonical cart-line key: product id + the chosen option value ids. Menu
 * adds, the product-page picker, reorder, and shared-cart resolution must all
 * build it the same way (`id::v1|v2`, empty options -> `id::`) so the same treat
 * merges into one line. Dependency-free so both the server-only cart resolver
 * and the client components can share it.
 */
export const menuCartKey = (productId: string, valueIds: string[]): string =>
  `${productId}::${valueIds.join("|")}`;
