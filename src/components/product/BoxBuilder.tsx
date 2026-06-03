"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { useCart } from "@/components/cart/CartContext";
import { useFeatures } from "@/components/features/FeaturesProvider";
import { formatPrice } from "@/lib/catalog";
import { ImagePlaceholder } from "@/components/ui/ImagePlaceholder";
import type { BoxTemplate } from "@/lib/types";

/**
 * Pick exactly `itemCount` items from the eligible pool for a flat box price.
 * The chosen picks (flat list with repeats) are encoded into the cart line key
 * so the server can re-validate count + eligibility; `selectedOptions` keeps a
 * human-readable contents list for the bake list / packing slip.
 */
export function BoxBuilder({ box }: { box: BoxTemplate }) {
  const { addItem } = useCart();
  const features = useFeatures();
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [added, setAdded] = useState(false);

  const chosen = useMemo(
    () => Object.values(counts).reduce((sum, n) => sum + n, 0),
    [counts],
  );
  const remaining = box.itemCount - chosen;

  if (!features.buildABox) return null;

  function bump(productId: string, delta: number) {
    setCounts((prev) => {
      const next = Math.max(0, (prev[productId] ?? 0) + delta);
      if (delta > 0 && remaining <= 0) return prev; // box already full
      return { ...prev, [productId]: next };
    });
  }

  function add() {
    if (remaining !== 0) return;
    const flatIds: string[] = [];
    const optionRows = box.eligibleProducts
      .filter((p) => (counts[p.id] ?? 0) > 0)
      .map((p) => {
        const qty = counts[p.id];
        for (let i = 0; i < qty; i++) flatIds.push(p.id);
        return { optionName: "Includes", valueLabel: `${qty}× ${p.name}`, priceDeltaCents: 0 };
      });
    addItem({
      key: `box::${box.slug}::${[...flatIds].sort().join("|")}`,
      productId: `box:${box.slug}`,
      slug: box.slug,
      name: box.name,
      unitPriceCents: box.priceCents,
      quantity: 1,
      selectedOptions: optionRows,
    });
    setCounts({});
    setAdded(true);
    window.setTimeout(() => setAdded(false), 1500);
  }

  return (
    <div>
      <div className="flex items-center justify-between rounded-xl bg-blush-soft/60 px-4 py-3 text-sm font-semibold text-rose-deep">
        <span>
          {chosen} of {box.itemCount} chosen
        </span>
        <span>{formatPrice(box.priceCents)}</span>
      </div>

      <ul className="mt-4 grid gap-3 sm:grid-cols-2">
        {box.eligibleProducts.map((product) => {
          const qty = counts[product.id] ?? 0;
          return (
            <li
              key={product.id}
              className="flex items-center gap-3 rounded-2xl border border-line bg-white p-3"
            >
              <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl">
                {product.imageUrls && product.imageUrls.length > 0 ? (
                  <Image src={product.imageUrls[0]} alt={product.name} fill sizes="56px" className="object-cover" />
                ) : (
                  <ImagePlaceholder aspect="square" label="" icon="🍪" />
                )}
              </div>
              <span className="flex-1 text-sm font-semibold">{product.name}</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  aria-label={`Remove one ${product.name}`}
                  onClick={() => bump(product.id, -1)}
                  disabled={qty === 0}
                  className="h-8 w-8 rounded-full border border-line text-ink disabled:opacity-40"
                >
                  −
                </button>
                <span className="w-5 text-center text-sm font-semibold">{qty}</span>
                <button
                  type="button"
                  aria-label={`Add one ${product.name}`}
                  onClick={() => bump(product.id, 1)}
                  disabled={remaining <= 0}
                  className="h-8 w-8 rounded-full border border-line text-ink disabled:opacity-40"
                >
                  +
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        onClick={add}
        disabled={remaining !== 0}
        className="mt-6 rounded-full bg-rose-deep px-6 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-40"
      >
        {added
          ? "Added ✓"
          : remaining > 0
            ? `Pick ${remaining} more`
            : "Add box to cart"}
      </button>
    </div>
  );
}
