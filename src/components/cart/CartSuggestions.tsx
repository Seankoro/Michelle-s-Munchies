"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Product } from "@/lib/types";
import { useCart } from "@/components/cart/CartContext";
import { useFeatures } from "@/components/features/FeaturesProvider";
import { Badge } from "@/components/ui/Badge";
import { ScrollRail } from "@/components/ui/ScrollRail";
import { QuickPick } from "@/components/product/QuickPick";
import { loadCartSuggestions, type CartSuggestionData } from "@/app/cart/actions";
import { CART_SUGGESTION_LIMIT, rankCartSuggestions } from "@/lib/cart-suggestions";
import { menuCartKey } from "@/lib/cart-key";
import { formatPrice } from "@/lib/catalog";
import { cardImageUrl } from "@/lib/product-images";
import { cn } from "@/lib/cn";

/** How long an added treat stays in the row showing "Added" before it leaves. */
const ADDED_HOLD_MS = 1600;

/**
 * "Add a little something": a row of extra treats between the cart and the
 * subtotal, ranked by rankCartSuggestions. Built on ScrollRail, so each device
 * browses it its own way: a swipe on a phone, with the next card peeking in at
 * the screen edge; a swipe or the arrows on a tablet; the arrows, the slider or
 * a mouse drag on a computer. It stays one row at every width, so it never adds
 * more than one card's height to the page.
 *
 * A treat with no options adds in one tap. One with options opens the menu's
 * quick pick. Either way the card says "Added" for a moment, then leaves the
 * row, since it is in the cart now.
 */
export function CartSuggestions({ className }: { className?: string }) {
  const features = useFeatures();
  const { items, addItem } = useCart();
  const [data, setData] = useState<CartSuggestionData | null>(null);
  // The cart as it was when the row loaded. The order is ranked against this,
  // not the live cart, so adding a cookie does not send every other cookie to
  // the back of the row while the customer is browsing it.
  const [rankedFor, setRankedFor] = useState<string[]>([]);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const [picking, setPicking] = useState<Product | null>(null);
  // Added treats kept in place for a moment, so the card can confirm the add
  // instead of vanishing under the finger that tapped it.
  const [held, setHeld] = useState<ReadonlySet<string>>(new Set());
  const [announcement, setAnnouncement] = useState("");
  const rowRef = useRef<HTMLElement>(null);
  const timers = useRef(new Map<string, number>());

  useEffect(() => {
    if (!features.cartSuggestions) return;
    let active = true;
    loadCartSuggestions()
      .then((result) => {
        if (!active) return;
        setRankedFor(itemsRef.current.map((item) => item.productId));
        setData(result);
      })
      // The row is an extra. If it cannot load, the cart simply goes without.
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [features.cartSuggestions]);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((timer) => window.clearTimeout(timer));
  }, []);

  const cartIds = useMemo(() => new Set(items.map((item) => item.productId)), [items]);
  // Ranked once, then later adds only take cards out. A held treat stays in
  // its place while it shows "Added".
  const ordered = useMemo(
    () => (data ? rankCartSuggestions(data.pool, rankedFor, data.boughtIds, data.pool.length) : []),
    [data, rankedFor],
  );
  const ranked = useMemo(
    () =>
      ordered
        .filter((product) => !cartIds.has(product.id) || held.has(product.id))
        .slice(0, CART_SUGGESTION_LIMIT),
    [ordered, cartIds, held],
  );
  const bought = useMemo(() => new Set(data?.boughtIds), [data]);

  function hold(id: string) {
    window.clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setHeld((prev) => new Set(prev).add(id));
  }

  function release(id: string, afterMs: number) {
    window.clearTimeout(timers.current.get(id));
    timers.current.set(
      id,
      window.setTimeout(() => {
        timers.current.delete(id);
        // A card holding keyboard focus is about to go, which would drop focus
        // to the page. Hand it to the card that slides into its place.
        const card = rowRef.current?.querySelector<HTMLElement>(`[data-suggestion="${id}"]`);
        const next =
          card?.contains(document.activeElement) &&
          (card.nextElementSibling ?? card.previousElementSibling)?.querySelector<HTMLElement>(
            "button",
          );
        setHeld((prev) => {
          const rest = new Set(prev);
          rest.delete(id);
          return rest;
        });
        if (next) requestAnimationFrame(() => next.focus());
      }, afterMs),
    );
  }

  function handleAdd(product: Product) {
    if (product.options.length > 0) {
      hold(product.id);
      setPicking(product);
      return;
    }
    hold(product.id);
    addItem({
      key: menuCartKey(product.id, []),
      productId: product.id,
      slug: product.slug,
      name: product.name,
      unitPriceCents: product.basePriceCents,
      quantity: 1,
      selectedOptions: [],
      imageUrl: cardImageUrl(product),
    });
    setAnnouncement(`Added ${product.name} to your cart.`);
    release(product.id, ADDED_HOLD_MS);
  }

  function closePick() {
    if (picking) release(picking.id, cartIds.has(picking.id) ? ADDED_HOLD_MS : 0);
    setPicking(null);
  }

  if (!features.cartSuggestions || ranked.length === 0) return null;

  return (
    <section ref={rowRef} aria-labelledby="cart-suggestions-heading" className={className}>
      <h2 id="cart-suggestions-heading" className="font-display text-2xl font-semibold">
        Add a little something
      </h2>
      <div className="mt-4">
        <ScrollRail
          label="Suggested treats"
          gridAtXl={false}
          trackClassName="relative -mx-6 flex gap-3 overflow-x-auto px-6 pb-2 no-scrollbar sm:mx-0 sm:px-0"
        >
          {ranked.map((product) => (
            <SuggestionCard
              key={product.id}
              product={product}
              boughtBefore={bought.has(product.id)}
              added={held.has(product.id) && cartIds.has(product.id)}
              onAdd={() => handleAdd(product)}
            />
          ))}
        </ScrollRail>
      </div>
      <span className="sr-only" role="status" aria-live="polite">
        {announcement}
      </span>
      {picking && <QuickPick product={picking} open onClose={closePick} />}
    </section>
  );
}

function SuggestionCard({
  product,
  boughtBefore,
  added,
  onAdd,
}: {
  product: Product;
  boughtBefore: boolean;
  added: boolean;
  onAdd: () => void;
}) {
  const href = `/menu/${product.slug}`;
  const image = cardImageUrl(product);
  const hasOptions = product.options.length > 0;

  return (
    <article
      data-suggestion={product.id}
      className="flex w-36 shrink-0 flex-col overflow-hidden rounded-2xl border border-line bg-white sm:w-40"
    >
      <Link href={href} className="relative block aspect-square" tabIndex={-1} aria-hidden="true">
        {image ? (
          <Image
            src={image}
            alt=""
            fill
            sizes="160px"
            className="object-cover"
            draggable={false}
          />
        ) : (
          <span className="flex h-full items-center justify-center bg-blush-soft text-3xl">
            🧁
          </span>
        )}
        {/* One badge per card, the most personal first. */}
        <span className="absolute left-2 top-2">
          {boughtBefore ? (
            <Badge tone="dietary">You had this</Badge>
          ) : product.isBestSeller ? (
            <Badge tone="bestseller">★ Best seller</Badge>
          ) : product.isRecommended ? (
            <Badge tone="recommended">Michelle&rsquo;s pick</Badge>
          ) : null}
        </span>
      </Link>
      <div className="flex flex-1 flex-col gap-1 p-3">
        <Link
          href={href}
          className="line-clamp-2 text-sm font-semibold leading-snug text-ink transition hover:text-rose-ink"
        >
          {product.name}
        </Link>
        <p className="text-sm text-muted">
          {hasOptions && "from "}
          {formatPrice(product.basePriceCents)}
        </p>
        <button
          type="button"
          // Already in the cart, so a second tap must not add another.
          onClick={added ? undefined : onAdd}
          aria-disabled={added}
          aria-label={
            added
              ? `${product.name} added to cart`
              : hasOptions
                ? `Choose options for ${product.name}`
                : `Add ${product.name} to cart`
          }
          className={cn(
            "mt-auto h-10 w-full rounded-full text-sm font-semibold transition active:scale-95",
            added
              ? "animate-pop bg-success text-white"
              : hasOptions
                ? "border border-line bg-white text-ink hover:border-rose"
                : "bg-rose-deep text-white hover:brightness-110",
          )}
        >
          {added ? "Added ✓" : hasOptions ? "Choose" : "Add"}
        </button>
      </div>
    </article>
  );
}
