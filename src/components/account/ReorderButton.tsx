"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useCart } from "@/components/cart/CartContext";
import { buildReorderCart } from "@/app/account/actions";

export function ReorderButton({ orderNumber }: { orderNumber: string }) {
  const { addItem } = useCart();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleReorder() {
    setBusy(true);
    setMessage(null);
    const result = await buildReorderCart(orderNumber);
    if (!result.ok) {
      setBusy(false);
      setMessage(result.error);
      return;
    }
    result.items.forEach(addItem);
    if (result.skipped.length > 0) {
      setMessage(`Added to cart. We skipped ${result.skipped.join(", ")} as they're unavailable.`);
      window.setTimeout(() => router.push("/cart"), 1400);
    } else {
      router.push("/cart");
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleReorder}
        disabled={busy}
        className="text-sm font-semibold text-rose transition hover:text-rose-deep disabled:opacity-60"
      >
        {busy ? "Adding…" : "Order again"}
      </button>
      {message && <span className="max-w-48 text-right text-xs text-muted">{message}</span>}
    </div>
  );
}
