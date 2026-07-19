"use client";

import { useRouter } from "next/navigation";
import { useCart } from "@/components/cart/CartContext";
import { Button } from "@/components/ui/Button";
import type { SharedFavourite } from "@/lib/wishlist-share";

/**
 * Adds the option-less, in-stock favourites straight to the cart. Items with
 * choices like size or flavour are left for the recipient to open and
 * configure, and sold-out items are never auto-added.
 */
export function AddAllFavouritesButton({ items }: { items: SharedFavourite[] }) {
  const { addItem } = useCart();
  const router = useRouter();
  const simple = items.filter((i) => !i.hasOptions && i.isAvailable);
  if (simple.length === 0) return null;

  function addAll() {
    simple.forEach((item) =>
      addItem({
        key: item.id,
        productId: item.id,
        slug: item.slug,
        name: item.name,
        unitPriceCents: item.priceCents,
        quantity: 1,
        selectedOptions: [],
        imageUrl: item.imageUrl ?? undefined,
      }),
    );
    router.push("/cart");
  }

  return (
    <Button type="button" size="sm" onClick={addAll}>
      Add {simple.length} to cart
    </Button>
  );
}
