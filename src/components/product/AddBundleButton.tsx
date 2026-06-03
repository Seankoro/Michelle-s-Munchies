"use client";

import { useState } from "react";
import { useCart } from "@/components/cart/CartContext";
import { useFeatures } from "@/components/features/FeaturesProvider";
import type { Bundle } from "@/lib/types";

/**
 * Adds a bundle to the cart as a single line. The cart line's `productId` uses a
 * non-UUID sentinel (`bundle:<slug>`) so `createOrder` stores it with a null
 * product_id; the contained items are snapshotted into `selectedOptions` for the
 * bake list, packing slips, and order display.
 */
export function AddBundleButton({ bundle }: { bundle: Bundle }) {
  const { addItem } = useCart();
  const features = useFeatures();
  const [added, setAdded] = useState(false);
  if (!features.bundles) return null;

  function add() {
    addItem({
      key: `bundle::${bundle.slug}`,
      productId: `bundle:${bundle.slug}`,
      slug: bundle.slug,
      name: bundle.name,
      unitPriceCents: bundle.priceCents,
      quantity: 1,
      selectedOptions: bundle.items.map((item) => ({
        optionName: "Includes",
        valueLabel: `${item.quantity}× ${item.productName}`,
        priceDeltaCents: 0,
      })),
    });
    setAdded(true);
    window.setTimeout(() => setAdded(false), 1500);
  }

  return (
    <button
      type="button"
      onClick={add}
      className="rounded-full bg-rose-deep px-6 py-2.5 text-sm font-semibold text-white transition hover:brightness-110"
    >
      {added ? "Added ✓" : "Add bundle to cart"}
    </button>
  );
}
