"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Product } from "@/lib/types";
import { OptionPicker } from "./OptionPicker";
import { Button, buttonClasses } from "@/components/ui/Button";
import { formatPrice } from "@/lib/catalog";
import { useDialog } from "@/lib/useDialog";

/**
 * The "quick-pick" popover, choose options for a product without leaving the
 * listing page in the impulse-buy flow. Opened from a ProductCard for items that
 * have options. Bottom-sheet on mobile, centred modal on larger screens.
 */
export function QuickPick({
  product,
  open,
  onClose,
}: {
  product: Product;
  open: boolean;
  onClose: () => void;
}) {
  const [added, setAdded] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useDialog(open, onClose, panelRef);

  // Reset the "added" confirmation whenever the popover is reopened.
  useEffect(() => {
    if (!open) setAdded(false);
  }, [open]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Add ${product.name} to cart`}
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 sm:items-center sm:p-4"
    >
      <div
        ref={panelRef}
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-md rounded-t-2xl bg-white p-5 shadow-soft sm:rounded-2xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-blush-soft text-2xl">
              <span aria-hidden="true">🧁</span>
            </div>
            <div>
              <h2 className="font-display text-lg font-semibold">{product.name}</h2>
              <p className="text-sm text-muted">from {formatPrice(product.basePriceCents)}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-full p-2 text-muted transition hover:bg-blush-soft"
          >
            ✕
          </button>
        </div>

        <div className="mt-5">
          {added ? (
            <div className="text-center">
              <p className="text-4xl" aria-hidden="true">
                🎀
              </p>
              <p className="mt-2 font-display text-lg font-semibold">Added to your cart!</p>
              <div className="mt-5 flex gap-3">
                <Button variant="secondary" className="flex-1" onClick={onClose}>
                  Keep browsing
                </Button>
                <Link href="/cart" className={buttonClasses({ className: "flex-1" })}>
                  Go to cart
                </Link>
              </div>
            </div>
          ) : (
            <OptionPicker product={product} onAdded={() => setAdded(true)} />
          )}
        </div>
      </div>
    </div>
  );
}
