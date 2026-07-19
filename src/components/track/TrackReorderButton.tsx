"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCart } from "@/components/cart/CartContext";
import { reorderFromToken } from "@/app/track/actions";
import { buttonClasses } from "@/components/ui/Button";
import { SkippedItems } from "@/components/cart/SkippedItems";
import type { SkippedLine } from "@/lib/cart-resolve";

/**
 * "Order this again" for the tracking page. Works for guests, who never make an
 * account in the WhatsApp + PayNow flow, using the tracking token as auth. Loads
 * the past order's available items into the cart; anything it couldn't re-add
 * (sold out, or a bundle/box that can't be rebuilt) is shown with a link to
 * re-add it, so we don't whisk the customer to the cart before they can tap it.
 */
export function TrackReorderButton({ token }: { token: string }) {
  const { addItem } = useCart();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState(false);
  const [errored, setErrored] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<SkippedLine[]>([]);

  async function handleReorder() {
    setBusy(true);
    setNote(null);
    setErrored(false);
    setSkipped([]);
    const result = await reorderFromToken(token);
    if (!result.ok) {
      setBusy(false);
      setErrored(true);
      setNote(result.error);
      setSkipped(result.skipped ?? []);
      return;
    }
    result.items.forEach(addItem);
    if (result.skipped.length > 0) {
      // Some went in, some didn't; stay so they can tap a skipped item to re-add.
      setBusy(false);
      setAdded(true);
      setNote("Added to your cart. These couldn’t be re-added automatically:");
      setSkipped(result.skipped);
    } else {
      router.push("/cart");
    }
  }

  return (
    <div className="flex flex-col items-center gap-2">
      {!added && (
        <button
          type="button"
          onClick={handleReorder}
          disabled={busy}
          className={buttonClasses({ size: "lg", className: "disabled:opacity-60" })}
        >
          {busy ? "Adding…" : "Order this again"}
        </button>
      )}
      {note && (
        <p className="max-w-xs text-center text-xs text-muted">
          {note}
          {skipped.length > 0 && (
            <>
              {" "}
              <SkippedItems items={skipped} />.
            </>
          )}
        </p>
      )}
      {added && (
        <Link href="/cart" className={buttonClasses({ size: "lg" })}>
          Go to cart →
        </Link>
      )}
      {errored && (
        <Link
          href="/menu"
          className="text-xs font-semibold text-rose-deep underline hover:text-rose"
        >
          Browse the menu
        </Link>
      )}
    </div>
  );
}
