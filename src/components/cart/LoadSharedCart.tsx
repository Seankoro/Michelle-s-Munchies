"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCart } from "@/components/cart/CartContext";
import { SkippedItems } from "@/components/cart/SkippedItems";
import { buttonClasses } from "@/components/ui/Button";
import type { CartItem } from "@/lib/types";
import type { SkippedLine } from "@/lib/cart-resolve";

/** Loads resolved shared-cart items into the cart on mount, then routes to /cart. */
export function LoadSharedCart({ items, skipped }: { items: CartItem[]; skipped: SkippedLine[] }) {
  const { addItem, hydrated } = useCart();
  const router = useRouter();
  const done = useRef(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!hydrated || done.current) return;
    done.current = true;
    items.forEach((item) => addItem(item));
    setReady(true);
    // Nothing skipped: slip straight to the cart. If some lines were skipped,
    // stay so the customer can tap them to re-add before moving on.
    if (skipped.length === 0) {
      const id = window.setTimeout(() => router.replace("/cart"), 400);
      return () => window.clearTimeout(id);
    }
  }, [hydrated, items, skipped, addItem, router]);

  return (
    <main className="mx-auto max-w-md px-6 py-20 text-center">
      <p className="text-5xl" aria-hidden="true">
        🎀
      </p>
      <h1 className="mt-4 font-display text-2xl font-semibold">
        {ready ? "Added to your cart!" : "Loading the order…"}
      </h1>
      {skipped.length > 0 ? (
        <>
          <p className="mt-3 text-sm text-muted">
            We couldn&rsquo;t add <SkippedItems items={skipped} />. Prices are updated to
            today&rsquo;s.
          </p>
          <Link href="/cart" className={buttonClasses({ size: "lg", className: "mt-5" })}>
            Go to cart →
          </Link>
        </>
      ) : (
        <p className="mt-2 text-sm text-muted">Taking you to your cart…</p>
      )}
    </main>
  );
}
