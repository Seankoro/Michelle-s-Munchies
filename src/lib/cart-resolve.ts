import "server-only";
import { fetchProducts } from "@/lib/products";
import type { CartItem, SelectedOption } from "@/lib/types";

export type RawSelection = { optionName?: string; valueLabel: string };
export type RawCartLine = {
  productId: string | null;
  /** Name fallback when matching by id fails, since order snapshots keep the name. */
  productName?: string | null;
  quantity: number;
  selections: RawSelection[];
};

/**
 * Re-resolve "raw" cart lines against the current catalog, with live price and
 * availability, options matched by label, and the cart key built like
 * OptionPicker so lines merge with menu adds. Lines whose product is gone or
 * sold-out, or whose required options no longer exist, are reported in `skipped`
 * by name.
 *
 * Shared by "Order again" in buildReorderCart and shared-cart links in
 * resolveSharedCart so the resolution logic lives in one place.
 */
export async function resolveCartLines(
  lines: RawCartLine[],
): Promise<{ items: CartItem[]; skipped: string[] }> {
  const products = await fetchProducts();
  const items: CartItem[] = [];
  const skipped: string[] = [];

  for (const line of lines) {
    const product =
      (line.productId ? products.find((p) => p.id === line.productId) : undefined) ??
      (line.productName ? products.find((p) => p.name === line.productName) : undefined);
    if (!product || !product.isAvailable) {
      skipped.push(product?.name ?? line.productName ?? "an unavailable item");
      continue;
    }

    const selectedOptions: SelectedOption[] = [];
    const valueIds: string[] = [];
    let mismatch = false;
    for (const option of product.options) {
      // Match a chosen value by option name first, else by a label this option offers.
      const chosen =
        line.selections.find((s) => s.optionName === option.name) ??
        line.selections.find((s) => option.values.some((v) => v.label === s.valueLabel));
      const value = chosen
        ? option.values.find((v) => v.label === chosen.valueLabel)
        : option.required
          ? option.values[0]
          : undefined;
      if (option.required && !value) {
        mismatch = true;
        break;
      }
      if (value) {
        selectedOptions.push({
          optionName: option.name,
          valueLabel: value.label,
          priceDeltaCents: value.priceDeltaCents,
        });
        valueIds.push(value.id);
      }
    }
    if (mismatch) {
      skipped.push(product.name);
      continue;
    }

    const key = product.options.length > 0 ? `${product.id}::${valueIds.join("|")}` : product.id;
    const unitPriceCents =
      product.basePriceCents + selectedOptions.reduce((sum, o) => sum + o.priceDeltaCents, 0);

    items.push({
      key,
      productId: product.id,
      slug: product.slug,
      name: product.name,
      unitPriceCents,
      quantity: line.quantity,
      selectedOptions,
    });
  }

  return { items, skipped };
}
