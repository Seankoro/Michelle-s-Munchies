"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCart } from "@/components/cart/CartContext";
import { buildReorderCart } from "@/app/account/actions";
import { SkippedItems } from "@/components/cart/SkippedItems";
import type { SkippedLine } from "@/lib/cart-resolve";

export function ReorderButton({ orderNumber }: { orderNumber: string }) {
  const { addItem } = useCart();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<SkippedLine[]>([]);

  async function handleReorder() {
    setBusy(true);
    setNote(null);
    setSkipped([]);
    const result = await buildReorderCart(orderNumber);
    if (!result.ok) {
      setBusy(false);
      setNote(result.error);
      setSkipped(result.skipped ?? []);
      return;
    }
    result.items.forEach(addItem);
    if (result.skipped.length > 0) {
      // Stay put so the customer can tap a skipped item to re-add it.
      setBusy(false);
      setAdded(true);
      setNote("Added to cart. We skipped:");
      setSkipped(result.skipped);
    } else {
      router.push("/cart");
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      {added ? (
        <Link
          href="/cart"
          className="text-sm font-semibold text-rose-ink transition hover:text-rose"
        >
          Go to cart →
        </Link>
      ) : (
        <button
          type="button"
          onClick={handleReorder}
          disabled={busy}
          className="text-sm font-semibold text-rose-ink transition hover:text-rose disabled:opacity-60"
        >
          {busy ? "Adding…" : "Order again"}
        </button>
      )}
      {note && (
        <span className="max-w-48 text-right text-xs text-muted">
          {note}
          {skipped.length > 0 && (
            <>
              {" "}
              <SkippedItems items={skipped} />.
            </>
          )}
        </span>
      )}
    </div>
  );
}
