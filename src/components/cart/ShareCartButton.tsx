"use client";

import { useState } from "react";
import { useCart } from "@/components/cart/CartContext";
import { useFeatures } from "@/components/features/FeaturesProvider";
import { encodeSharedCart } from "@/lib/cart-share";

/** "Share this order", copies a link that loads the basket into someone's cart. */
export function ShareCartButton() {
  const { items } = useCart();
  const features = useFeatures();
  const [copied, setCopied] = useState(false);

  if (!features.cartSharing || items.length === 0) return null;

  async function share() {
    const payload = encodeSharedCart(
      items.map((i) => ({
        productId: i.productId,
        selections: i.selectedOptions.map((o) => ({
          optionName: o.optionName,
          valueLabel: o.valueLabel,
        })),
        quantity: i.quantity,
        name: i.name,
      })),
    );
    const url = `${window.location.origin}/cart/shared?c=${encodeURIComponent(payload)}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked, surface the URL for manual copy.
      window.prompt("Copy your order link:", url);
    }
  }

  return (
    <button
      type="button"
      onClick={share}
      className="mt-3 block w-full text-center text-sm font-semibold text-rose-ink transition hover:text-rose"
    >
      {copied ? "Link copied ✓" : "🔗 Share this order"}
    </button>
  );
}
