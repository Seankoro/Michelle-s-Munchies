"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useCart } from "@/components/cart/CartContext";
import { useFeatures } from "@/components/features/FeaturesProvider";
import { ShareCartButton } from "@/components/cart/ShareCartButton";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { fetchClientSettingsRow } from "@/lib/client-settings";
import { formatPrice, mockSettings } from "@/lib/catalog";
import { buttonClasses } from "@/components/ui/Button";

export default function CartPage() {
  const { items, updateQuantity, removeItem, subtotalCents, hydrated } = useCart();
  const features = useFeatures();

  // Live free-delivery threshold (falls back to the default until loaded).
  const [freeMin, setFreeMin] = useState(mockSettings.freeDeliveryMinCents);
  // Spend-gift nudge details (null until loaded / when off).
  const [giftThreshold, setGiftThreshold] = useState<number | null>(null);
  const [giftName, setGiftName] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void (async () => {
      const row = await fetchClientSettingsRow();
      if (!active || !row) return;
      if (typeof row.free_delivery_min_cents === "number") setFreeMin(row.free_delivery_min_cents);
      if (row.free_gift_threshold_cents && row.free_gift_product_id) {
        setGiftThreshold(row.free_gift_threshold_cents);
        const { data: product } = await createBrowserSupabase()
          .from("products")
          .select("name")
          .eq("id", row.free_gift_product_id)
          .maybeSingle();
        if (active) setGiftName((product as { name: string } | null)?.name ?? null);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  if (!hydrated) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-16 text-center text-muted">
        Loading your cart…
      </main>
    );
  }

  if (items.length === 0) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-20 text-center">
        <p className="text-5xl" aria-hidden="true">
          🎀
        </p>
        <h1 className="mt-4 font-display text-3xl font-semibold">Your cart is empty</h1>
        <p className="mt-2 text-muted">Let&rsquo;s find you something freshly baked.</p>
        <Link href="/menu" className={buttonClasses({ className: "mt-8", size: "lg" })}>
          Browse the menu
        </Link>
      </main>
    );
  }

  const remaining = Math.max(0, freeMin - subtotalCents);
  const qualifiesForFreeDelivery = remaining === 0;

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="font-display text-4xl font-semibold">Your cart</h1>

      <ul className="mt-8 flex flex-col gap-4">
        {items.map((item) => (
          <li
            key={item.key}
            className="flex gap-4 rounded-2xl border border-line bg-white p-4"
          >
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-blush-soft text-2xl">
              <span aria-hidden="true">🧁</span>
            </div>

            <div className="flex flex-1 flex-col gap-1">
              <div className="flex items-start justify-between gap-2">
                <Link
                  href={`/menu/${item.slug}`}
                  className="font-display text-lg font-semibold transition hover:text-rose-deep"
                >
                  {item.name}
                </Link>
                <span className="font-semibold">
                  {formatPrice(item.unitPriceCents * item.quantity)}
                </span>
              </div>

              {item.selectedOptions.length > 0 && (
                <p className="text-sm text-muted">
                  {item.selectedOptions
                    .map((option) => `${option.optionName}: ${option.valueLabel}`)
                    .join(" · ")}
                </p>
              )}

              <div className="mt-2 flex items-center justify-between">
                <div className="inline-flex items-center rounded-full border border-line">
                  <button
                    type="button"
                    aria-label="Decrease quantity"
                    onClick={() => updateQuantity(item.key, item.quantity - 1)}
                    className="flex h-8 w-8 items-center justify-center rounded-full text-lg text-ink hover:bg-blush-soft"
                  >
                    −
                  </button>
                  <span className="w-8 text-center text-sm font-semibold">{item.quantity}</span>
                  <button
                    type="button"
                    aria-label="Increase quantity"
                    onClick={() => updateQuantity(item.key, item.quantity + 1)}
                    className="flex h-8 w-8 items-center justify-center rounded-full text-lg text-ink hover:bg-blush-soft"
                  >
                    +
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => removeItem(item.key)}
                  className="text-sm font-semibold text-muted transition hover:text-rose-deep"
                >
                  Remove
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>

      {/* Free-delivery nudge */}
      <div className="mt-6 rounded-2xl bg-blush-soft/60 px-4 py-3 text-sm text-rose-deep">
        {qualifiesForFreeDelivery
          ? "🎉 Your order qualifies for free delivery!"
          : `🚚 You're ${formatPrice(remaining)} away from free delivery.`}
      </div>

      {/* Spend-gift nudge */}
      {features.spendGift && giftThreshold && giftName && (
        <div className="mt-3 rounded-2xl bg-blush-soft/60 px-4 py-3 text-sm text-rose-deep">
          {subtotalCents >= giftThreshold
            ? `🎁 You've earned a free ${giftName}! We'll add it to your order.`
            : `🎁 Spend ${formatPrice(giftThreshold - subtotalCents)} more for a free ${giftName}.`}
        </div>
      )}

      {/* Summary */}
      <div className="mt-6 rounded-2xl border border-line bg-white p-5">
        <div className="flex items-center justify-between">
          <span className="text-muted">Subtotal</span>
          <span className="font-semibold">{formatPrice(subtotalCents)}</span>
        </div>
        <p className="mt-1 text-xs text-muted">
          Delivery fee (if any) and pickup/delivery scheduling are calculated at checkout.
        </p>

        <Link
          href="/checkout"
          className={buttonClasses({ size: "lg", className: "mt-5 w-full" })}
        >
          Proceed to checkout
        </Link>
        <Link
          href="/menu"
          className="mt-3 block text-center text-sm font-semibold text-rose transition hover:text-rose-deep"
        >
          Continue shopping
        </Link>
        <ShareCartButton />
      </div>
    </main>
  );
}
