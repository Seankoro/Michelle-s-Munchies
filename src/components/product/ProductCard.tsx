"use client";

import Link from "next/link";
import Image from "next/image";
import { useState } from "react";
import type { Product } from "@/lib/types";
import { ImagePlaceholder } from "@/components/ui/ImagePlaceholder";
import { Badge } from "@/components/ui/Badge";
import { AllergenChips } from "./AllergenChips";
import { QuickPick } from "./QuickPick";
import { FavouriteButton } from "@/components/wishlist/FavouriteButton";
import { useCart } from "@/components/cart/CartContext";
import { useFeatures } from "@/components/features/FeaturesProvider";
import { formatPrice } from "@/lib/catalog";
import { cn } from "@/lib/cn";

export function ProductCard({ product }: { product: Product }) {
  const { addItem } = useCart();
  const { drops } = useFeatures();
  const [quickOpen, setQuickOpen] = useState(false);
  const [added, setAdded] = useState(false);

  const hasOptions = product.options.length > 0;
  const soldOut = !product.isAvailable;
  const upcoming =
    drops && Boolean(product.availableFrom) && new Date(product.availableFrom as string) > new Date();
  const detailHref = `/menu/${product.slug}`;

  function handleAdd() {
    if (soldOut || upcoming) return;
    // Items with options need a choice first → open the quick-pick popover.
    if (hasOptions) {
      setQuickOpen(true);
      return;
    }
    // Simple items add instantly from the card.
    addItem({
      key: product.id,
      productId: product.id,
      slug: product.slug,
      name: product.name,
      unitPriceCents: product.basePriceCents,
      quantity: 1,
      selectedOptions: [],
    });
    setAdded(true);
    window.setTimeout(() => setAdded(false), 1600);
  }

  return (
    <>
      <article className="group relative flex h-full flex-col overflow-hidden rounded-2xl border border-line bg-white shadow-card transition duration-300 hover:-translate-y-1 hover:shadow-soft">
        <FavouriteButton
          productId={product.id}
          soldOut={!product.isAvailable}
          className="absolute right-3 top-3 z-10"
        />
        <Link href={detailHref} className="relative block">
          {product.imageUrls && product.imageUrls.length > 0 ? (
            <div className="relative aspect-square w-full overflow-hidden">
              <Image
                src={product.imageUrls[0]}
                alt={product.name}
                fill
                sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, (max-width: 1280px) 33vw, 25vw"
                className="object-cover transition-transform duration-500 group-hover:scale-105"
              />
            </div>
          ) : (
            <ImagePlaceholder aspect="square" label="Product photo" className="rounded-none border-0" />
          )}
          <div className="absolute left-3 top-3 flex flex-col items-start gap-1">
            {product.isBestSeller && <Badge tone="bestseller">★ Best seller</Badge>}
            {product.isRecommended && !product.isBestSeller && (
              <Badge tone="recommended">Recommended</Badge>
            )}
          </div>
          {soldOut && !upcoming && (
            <div className="absolute inset-0 flex items-center justify-center bg-white/55">
              <Badge tone="soldout">Sold out</Badge>
            </div>
          )}
          {upcoming && (
            <div className="absolute inset-0 flex items-center justify-center bg-white/55">
              <Badge tone="recommended">Coming soon</Badge>
            </div>
          )}
        </Link>

        <div className="flex flex-1 flex-col gap-3 p-4">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-display text-lg font-semibold leading-snug">
              <Link href={detailHref} className="transition hover:text-rose-deep">
                {product.name}
              </Link>
            </h3>
            <AllergenChips allergens={product.allergens} />
          </div>

          <p className="line-clamp-2 text-sm text-muted">{product.shortDescription}</p>

          <div className="mt-auto flex items-center justify-between gap-2 pt-1">
            <span className="font-semibold text-ink">
              {hasOptions && <span className="text-sm font-normal text-muted">from </span>}
              {formatPrice(product.basePriceCents)}
            </span>
            <button
              type="button"
              onClick={handleAdd}
              disabled={soldOut || upcoming}
              aria-label={
                upcoming
                  ? `${product.name} is coming soon`
                  : soldOut
                    ? `${product.name} is sold out`
                    : hasOptions
                      ? `Choose options for ${product.name}`
                      : `Add ${product.name} to cart`
              }
              className={cn(
                "rounded-full px-4 py-2 text-sm font-semibold text-white transition active:scale-95 disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60",
                added ? "animate-pop bg-sky-deep" : "bg-rose-deep hover:brightness-110",
              )}
            >
              {upcoming
                ? "Coming soon"
                : soldOut
                  ? "Sold out"
                  : added
                    ? "Added ✓"
                    : hasOptions
                      ? "Choose"
                      : "Add"}
            </button>
          </div>
        </div>
      </article>

      {hasOptions && (
        <QuickPick product={product} open={quickOpen} onClose={() => setQuickOpen(false)} />
      )}
    </>
  );
}
