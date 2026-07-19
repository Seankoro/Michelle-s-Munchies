"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Product } from "@/lib/types";
import { formatPrice } from "@/lib/catalog";
import { addItemsToOrderAction } from "@/app/track/actions";
import { cn } from "@/lib/cn";

type Line = { productId: string; quantity: number };

/**
 * "Forgot something?" on the tracking page. Adds treats to an order already
 * placed for the same date, so the customer pays no second delivery fee. Prices
 * are re-checked server-side; this only collects the picks.
 */
export function AddToOrderPanel({ token, products }: { token: string; products: Product[] }) {
  const router = useRouter();
  const available = products.filter((p) => p.isAvailable);
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<Line[]>(
    available[0] ? [{ productId: available[0].id, quantity: 1 }] : [],
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  if (available.length === 0) return null;

  const addTotal = lines.reduce((sum, line) => {
    const product = available.find((p) => p.id === line.productId);
    return sum + (product ? product.basePriceCents * line.quantity : 0);
  }, 0);

  const inputClass = "rounded-xl border border-line bg-white px-3 py-2 text-base focus:border-rose sm:text-sm";

  function setLine(index: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  async function submit() {
    setBusy(true);
    setMessage(null);
    const result = await addItemsToOrderAction(token, lines);
    setBusy(false);
    if (result.ok) {
      setMessage({ kind: "ok", text: "Added! Your order and total are updated below." });
      setOpen(false);
      router.refresh();
    } else {
      setMessage({ kind: "error", text: result.error });
    }
  }

  return (
    <div className="mt-6 rounded-2xl border border-line bg-white p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold">Forgot something?</h2>
          <p className="text-sm text-muted">Add more treats to this order, no extra delivery fee.</p>
        </div>
        {!open && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="shrink-0 rounded-full border border-line px-4 py-2 text-sm font-semibold text-rose-deep transition hover:border-rose active:scale-95"
          >
            Add treats
          </button>
        )}
      </div>

      {open && (
        <div className="mt-4 flex flex-col gap-2">
          {lines.map((line, index) => (
            <div key={index} className="flex items-center gap-2">
              <select
                value={line.productId}
                onChange={(e) => setLine(index, { productId: e.target.value })}
                aria-label="Treat"
                className={cn(inputClass, "flex-1")}
              >
                {available.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {formatPrice(p.basePriceCents)}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min={1}
                max={20}
                value={line.quantity}
                onChange={(e) =>
                  // Mirror the server's per-line cap of 20 so the preview total
                  // matches what actually gets added.
                  setLine(index, {
                    quantity: Math.min(20, Math.max(1, parseInt(e.target.value || "1", 10))),
                  })
                }
                aria-label="Quantity"
                className={cn(inputClass, "w-16")}
              />
              <button
                type="button"
                onClick={() => setLines((prev) => prev.filter((_, i) => i !== index))}
                aria-label="Remove item"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted transition hover:bg-blush-soft active:scale-90"
              >
                ✕
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setLines((prev) => [...prev, { productId: available[0].id, quantity: 1 }])}
            className="self-start rounded-full border border-line px-4 py-1.5 text-sm font-semibold transition hover:border-rose active:scale-95"
          >
            + Add another
          </button>
          <div className="mt-2 flex items-center justify-between border-t border-line pt-3">
            <span className="text-sm text-muted">
              Adds <span className="font-semibold text-ink">{formatPrice(addTotal)}</span>
            </span>
            <button
              type="button"
              onClick={submit}
              disabled={busy || lines.length === 0}
              className="rounded-full bg-rose-deep px-5 py-2 text-sm font-semibold text-white transition hover:brightness-110 active:scale-95 disabled:opacity-60"
            >
              {busy ? "Adding…" : "Add to my order"}
            </button>
          </div>
        </div>
      )}
      {message && (
        <p
          role="status"
          className={cn("mt-3 text-sm", message.kind === "ok" ? "text-success" : "text-rose-deep")}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
