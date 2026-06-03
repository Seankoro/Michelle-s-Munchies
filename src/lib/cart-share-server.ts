import "server-only";
import { resolveCartLines } from "@/lib/cart-resolve";
import type { CartItem } from "@/lib/types";
import type { SharedLine } from "@/lib/cart-share";

/**
 * Re-resolve shared-cart lines against the current catalog. Thin adapter over
 * the shared {@link resolveCartLines}; shared-cart links only carry value labels.
 */
export async function resolveSharedCart(
  lines: SharedLine[],
): Promise<{ items: CartItem[]; skipped: string[] }> {
  return resolveCartLines(
    lines.map((line) => ({
      productId: line.productId,
      quantity: line.quantity,
      selections: line.valueLabels.map((valueLabel) => ({ valueLabel })),
    })),
  );
}
