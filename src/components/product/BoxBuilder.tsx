"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { useCart } from "@/components/cart/CartContext";
import { useFeatures } from "@/components/features/FeaturesProvider";
import { formatPrice } from "@/lib/catalog";
import { ImagePlaceholder } from "@/components/ui/ImagePlaceholder";
import { cn } from "@/lib/cn";
import type { BoxTemplate, Product } from "@/lib/types";

// A pickable slot, a product optionally narrowed to one of its flavours.
type Choice = {
  key: string;
  flavour: string | null;
  soldOut: boolean;
};

// Expand a product into its pickable choices, one per available flavour when it
// has a Flavour option, or a single product-only choice when it does not.
function choicesFor(product: Product): Choice[] {
  const flavour = product.options.find((option) => option.name.toLowerCase() === "flavour");
  if (flavour && flavour.values.length > 0) {
    return flavour.values.map((value) => ({
      key: `${product.id}~${value.label}`,
      flavour: value.label,
      soldOut: value.isAvailable === false,
    }));
  }
  return [{ key: product.id, flavour: null, soldOut: false }];
}

/**
 * Fill a box like a basket. Pick up to `itemCount` treats from the eligible
 * pool for a flat price. A treat that has a Flavour option is picked by flavour,
 * so a slot is a product plus a flavour, and a treat without flavours is picked
 * as is. A sold-out flavour is disabled, since availability lives on the option
 * value. Each pick is encoded into the cart line key as `productId` or
 * `productId~flavour`, with repeats, so the server can re-validate the count,
 * eligibility, flavour availability, and the flat price.
 */
export function BoxBuilder({ box }: { box: BoxTemplate }) {
  const { addItem } = useCart();
  const features = useFeatures();
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [added, setAdded] = useState(false);

  const groups = useMemo(
    () => box.eligibleProducts.map((product) => ({ product, choices: choicesFor(product) })),
    [box.eligibleProducts],
  );

  const chosen = useMemo(() => Object.values(counts).reduce((sum, n) => sum + n, 0), [counts]);
  const remaining = box.itemCount - chosen;

  if (!features.buildABox) return null;

  function bump(key: string, delta: number) {
    setCounts((prev) => {
      const total = Object.values(prev).reduce((sum, n) => sum + n, 0);
      if (delta > 0 && total >= box.itemCount) return prev; // box already full
      return { ...prev, [key]: Math.max(0, (prev[key] ?? 0) + delta) };
    });
  }

  function labelFor(productName: string, flavour: string | null) {
    return flavour ? `${flavour} ${productName}` : productName;
  }

  function add() {
    if (remaining !== 0) return;
    const flatPicks: string[] = [];
    const optionRows = groups.flatMap(({ product, choices }) =>
      choices
        .filter((choice) => (counts[choice.key] ?? 0) > 0)
        .map((choice) => {
          const qty = counts[choice.key];
          for (let i = 0; i < qty; i++) flatPicks.push(choice.key);
          return {
            optionName: "Includes",
            valueLabel: `${qty}× ${labelFor(product.name, choice.flavour)}`,
            priceDeltaCents: 0,
          };
        }),
    );
    addItem({
      key: `box::${box.slug}::${[...flatPicks].sort().join("|")}`,
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

      <div className="mt-4 flex flex-col gap-5">
        {groups.map(({ product, choices }) => (
          <div key={product.id}>
            <div className="flex items-center gap-3">
              <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-xl">
                {product.imageUrls && product.imageUrls.length > 0 ? (
                  <Image
                    src={product.imageUrls[0]}
                    alt={product.name}
                    fill
                    sizes="48px"
                    className="object-cover"
                  />
                ) : (
                  <ImagePlaceholder aspect="square" label="" icon="🍪" />
                )}
              </div>
              <span className="text-sm font-semibold">{product.name}</span>
            </div>

            <ul className="mt-2 grid gap-2 sm:grid-cols-2">
              {choices.map((choice) => {
                const qty = counts[choice.key] ?? 0;
                return (
                  <li
                    key={choice.key}
                    className={cn(
                      "flex items-center gap-2 rounded-xl border border-line bg-white px-3 py-2",
                      choice.soldOut && "opacity-50",
                    )}
                  >
                    <span className="flex-1 text-sm">
                      {choice.flavour ?? "Add to box"}
                      {choice.soldOut && (
                        <span className="ml-1 text-xs text-muted">sold out</span>
                      )}
                    </span>
                    <button
                      type="button"
                      aria-label={`Remove one ${labelFor(product.name, choice.flavour)}`}
                      onClick={() => bump(choice.key, -1)}
                      disabled={qty === 0}
                      className="h-8 w-8 rounded-full border border-line text-ink transition active:scale-90 disabled:opacity-40"
                    >
                      −
                    </button>
                    <span className="w-5 text-center text-sm font-semibold">{qty}</span>
                    <button
                      type="button"
                      aria-label={`Add one ${labelFor(product.name, choice.flavour)}`}
                      onClick={() => bump(choice.key, 1)}
                      disabled={choice.soldOut || remaining <= 0}
                      className="h-8 w-8 rounded-full border border-line text-ink transition active:scale-90 disabled:opacity-40"
                    >
                      +
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

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
            : `Add box to cart · ${formatPrice(box.priceCents)}`}
      </button>
    </div>
  );
}
