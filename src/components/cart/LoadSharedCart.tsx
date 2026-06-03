"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useCart } from "@/components/cart/CartContext";
import type { CartItem } from "@/lib/types";

/** Loads resolved shared-cart items into the cart on mount, then routes to /cart. */
export function LoadSharedCart({ items, skipped }: { items: CartItem[]; skipped: string[] }) {
  const { addItem, hydrated } = useCart();
  const router = useRouter();
  const done = useRef(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!hydrated || done.current) return;
    done.current = true;
    items.forEach((item) => addItem(item));
    setReady(true);
    // Give the skipped notice a beat to be read, then go to the cart.
    const id = window.setTimeout(() => router.replace("/cart"), skipped.length > 0 ? 2500 : 400);
    return () => window.clearTimeout(id);
  }, [hydrated, items, skipped, addItem, router]);

  return (
    <main className="mx-auto max-w-md px-6 py-20 text-center">
      <p className="text-5xl" aria-hidden="true">
        🎀
      </p>
      <h1 className="mt-4 font-display text-2xl font-semibold">
        {ready ? "Added to your cart!" : "Loading the order…"}
      </h1>
      {skipped.length > 0 && (
        <p className="mt-3 text-sm text-muted">
          We skipped {skipped.join(", ")} as they&rsquo;re no longer available. Prices are updated to today&rsquo;s.
        </p>
      )}
      <p className="mt-2 text-sm text-muted">Taking you to your cart…</p>
    </main>
  );
}
