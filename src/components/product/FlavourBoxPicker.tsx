"use client";

import { useMemo, useState } from "react";
import type { Product } from "@/lib/types";
import { formatPrice } from "@/lib/catalog";
import { useCart } from "@/components/cart/CartContext";
import { useFeatures } from "@/components/features/FeaturesProvider";
import { cn } from "@/lib/cn";

/**
 * Per-item build-your-own box. Choose a box size, then pick that many flavours
 * of this one product, repeats allowed, for the size's flat price. The choices
 * come from the product's flavour option, so a sold-out flavour is disabled here
 * too. The picks are encoded into the cart key as labels, so checkout can
 * re-validate the count, the availability, and the price. This is the per-item
 * counterpart to the assortment Build a Box, which mixes different products.
 */
export function FlavourBoxPicker({ product }: { product: Product }) {
  const { addItem } = useCart();
  const features = useFeatures();
  const config = product.flavourBox;
  const [sizeIndex, setSizeIndex] = useState(0);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [added, setAdded] = useState(false);

  const flavours = useMemo(() => {
    const option = product.options.find((o) => o.name === config?.flavourOption);
    return option?.values ?? [];
  }, [product, config]);

  if (!features.buildABox || !config || config.sizes.length === 0 || flavours.length === 0) {
    return null;
  }

  const size = config.sizes[Math.min(sizeIndex, config.sizes.length - 1)];
  const chosen = Object.values(counts).reduce((sum, n) => sum + n, 0);
  const remaining = size.count - chosen;

  function selectSize(index: number) {
    setSizeIndex(index);
    setCounts({}); // reset picks so a smaller box is never over-filled
  }

  function bump(label: string, delta: number) {
    setCounts((prev) => {
      const total = Object.values(prev).reduce((sum, n) => sum + n, 0);
      if (delta > 0 && total >= size.count) return prev; // box already full
      return { ...prev, [label]: Math.max(0, (prev[label] ?? 0) + delta) };
    });
  }

  function add() {
    if (remaining !== 0) return;
    const flatLabels: string[] = [];
    const optionRows = flavours
      .filter((value) => (counts[value.label] ?? 0) > 0)
      .map((value) => {
        const qty = counts[value.label];
        for (let i = 0; i < qty; i++) flatLabels.push(value.label);
        return { optionName: size.label, valueLabel: `${qty}× ${value.label}`, priceDeltaCents: 0 };
      });
    addItem({
      key: `fbox::${product.id}::${size.count}::${[...flatLabels].sort().join("|")}`,
      productId: `fbox:${product.id}`,
      slug: product.slug,
      name: `${product.name} · ${size.label}`,
      unitPriceCents: size.priceCents,
      quantity: 1,
      selectedOptions: optionRows,
    });
    setCounts({});
    setAdded(true);
    window.setTimeout(() => setAdded(false), 1500);
  }

  return (
    <div className="rounded-2xl border border-line bg-white p-5">
      <h2 className="font-display text-lg font-semibold">Build your own box</h2>
      <p className="mt-1 text-sm text-muted">Pick a size, then choose your flavours.</p>

      {config.sizes.length > 1 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {config.sizes.map((option, index) => (
            <button
              key={option.label}
              type="button"
              onClick={() => selectSize(index)}
              aria-pressed={index === sizeIndex}
              className={cn(
                "rounded-full border px-4 py-2 text-sm font-semibold transition active:scale-95",
                index === sizeIndex
                  ? "border-rose-deep bg-blush-soft text-rose-deep"
                  : "border-line bg-white text-ink hover:border-rose",
              )}
            >
              {option.label} · {formatPrice(option.priceCents)}
            </button>
          ))}
        </div>
      )}

      <div className="mt-4 flex items-center justify-between rounded-xl bg-blush-soft/60 px-4 py-3 text-sm font-semibold text-rose-deep">
        <span>
          {chosen} of {size.count} chosen
        </span>
        <span>{formatPrice(size.priceCents)}</span>
      </div>

      <ul className="mt-4 grid gap-2 sm:grid-cols-2">
        {flavours.map((value) => {
          const soldOut = value.isAvailable === false;
          const qty = counts[value.label] ?? 0;
          return (
            <li
              key={value.id}
              className={cn(
                "flex items-center gap-3 rounded-2xl border border-line bg-white p-3",
                soldOut && "opacity-50",
              )}
            >
              <span className="flex-1 text-sm font-semibold">
                {value.label}
                {soldOut && <span className="ml-1 text-xs font-normal text-muted">sold out</span>}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  aria-label={`Remove one ${value.label}`}
                  onClick={() => bump(value.label, -1)}
                  disabled={qty === 0}
                  className="h-8 w-8 rounded-full border border-line text-ink transition active:scale-90 disabled:opacity-40"
                >
                  −
                </button>
                <span className="w-5 text-center text-sm font-semibold">{qty}</span>
                <button
                  type="button"
                  aria-label={`Add one ${value.label}`}
                  onClick={() => bump(value.label, 1)}
                  disabled={soldOut || remaining <= 0}
                  className="h-8 w-8 rounded-full border border-line text-ink transition active:scale-90 disabled:opacity-40"
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
        className="mt-6 w-full rounded-full bg-rose-deep px-6 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 active:scale-95 disabled:opacity-40"
      >
        {added
          ? "Added ✓"
          : remaining > 0
            ? `Pick ${remaining} more`
            : `Add box to cart · ${formatPrice(size.priceCents)}`}
      </button>
    </div>
  );
}
