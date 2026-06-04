"use client";

import { useRouter } from "next/navigation";
import { useCart } from "@/components/cart/CartContext";
import type { SharedFavourite } from "@/lib/wishlist-share";

/**
 * Adds the option-less favourites straight to the cart. Items with choices
 * like size or flavour are left for the recipient to open and configure, so we
 * don't guess an option for them.
 */
export function AddAllFavouritesButton({ items }: { items: SharedFavourite[] }) {
  const { addItem } = useCart();
  const router = useRouter();
  const simple = items.filter((i) => !i.hasOptions);
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
      }),
    );
    router.push("/cart");
  }

  return (
    <button
      type="button"
      onClick={addAll}
      className="rounded-full bg-rose-deep px-6 py-2.5 text-sm font-semibold text-white transition hover:brightness-110"
    >
      Add {simple.length} to cart
    </button>
  );
}
