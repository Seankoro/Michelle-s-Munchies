"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Product } from "@/lib/types";
import { formatPrice } from "@/lib/catalog";
import { addItemsToOrderAction } from "@/app/track/actions";
import { cn } from "@/lib/cn";

/**
 * One pending add. `chosen` maps an option group's id to the picked value's id,
 * the same shape the menu picker keeps. The server is sent labels rather than
 * ids, because it re-resolves every pick against the live catalogue.
 */
type Line = { productId: string; quantity: number; chosen: Record<string, string> };

/**
 * Pre-select the first available value of each group, like the menu picker, so a
 * sold-out flavour is never the default pick. Falls back to the first value when
 * a whole group is sold out, which the submit guard below then catches.
 */
function defaultChoices(product: Product | undefined): Record<string, string> {
  const initial: Record<string, string> = {};
  for (const option of product?.options ?? []) {
    const firstPick = option.values.find((v) => v.isAvailable !== false) ?? option.values[0];
    if (firstPick) initial[option.id] = firstPick.id;
  }
  return initial;
}

function newLine(product: Product): Line {
  return { productId: product.id, quantity: 1, chosen: defaultChoices(product) };
}

/** Base price with the deltas of this line's chosen values folded in, per unit. */
function unitPriceCents(product: Product, chosen: Record<string, string>): number {
  return product.options.reduce((price, option) => {
    const value = option.values.find((v) => v.id === chosen[option.id]);
    return price + (value ? value.priceDeltaCents : 0);
  }, product.basePriceCents);
}

/**
 * "Forgot something?" on the tracking page. Adds treats to an order already
 * placed for the same date, so the customer pays no second delivery fee. Prices
 * are re-checked server-side; this only collects the picks.
 */
export function AddToOrderPanel({ token, products }: { token: string; products: Product[] }) {
  const router = useRouter();
  const available = products.filter((p) => p.isAvailable);
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<Line[]>(available[0] ? [newLine(available[0])] : []);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  if (available.length === 0) return null;

  const productFor = (productId: string) => available.find((p) => p.id === productId);

  const addTotal = lines.reduce((sum, line) => {
    const product = productFor(line.productId);
    return sum + (product ? unitPriceCents(product, line.chosen) * line.quantity : 0);
  }, 0);

  // The same two gates the menu picker applies, and the ones the server refuses a
  // line over: every required group answered, and no chosen value unticked while
  // the panel sat open. Checked here so the customer sees why before the tap.
  const missingChoice = lines.some((line) =>
    (productFor(line.productId)?.options ?? []).some(
      (option) => option.required && !option.values.some((v) => v.id === line.chosen[option.id]),
    ),
  );
  const soldOutChoice = lines.some((line) =>
    (productFor(line.productId)?.options ?? []).some((option) =>
      option.values.some((v) => v.id === line.chosen[option.id] && v.isAvailable === false),
    ),
  );

  const inputClass = "rounded-xl border border-line bg-white px-3 py-2 text-base focus:border-rose sm:text-sm";

  function setLine(index: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  function setChoice(index: number, optionId: string, valueId: string) {
    setLines((prev) =>
      prev.map((l, i) => (i === index ? { ...l, chosen: { ...l.chosen, [optionId]: valueId } } : l)),
    );
  }

  async function submit() {
    setBusy(true);
    setMessage(null);
    const result = await addItemsToOrderAction(
      token,
      lines.map((line) => ({
        productId: line.productId,
        quantity: line.quantity,
        // Labels, not ids. Michelle's flavour editor regenerates option ids on
        // every save, so the server matches what was picked by its label.
        selections: (productFor(line.productId)?.options ?? []).flatMap((option) => {
          const value = option.values.find((v) => v.id === line.chosen[option.id]);
          return value ? [{ optionName: option.name, valueLabel: value.label }] : [];
        }),
      })),
    );
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
          {lines.map((line, index) => {
            const product = productFor(line.productId);
            return (
              <div key={index} className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <select
                    value={line.productId}
                    onChange={(e) =>
                      // A different treat brings its own option groups, so the
                      // picks start fresh instead of carrying ids that mean
                      // nothing on the new product.
                      setLine(index, {
                        productId: e.target.value,
                        chosen: defaultChoices(productFor(e.target.value)),
                      })
                    }
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
                {product && product.options.length > 0 && (
                  <div className="flex flex-col gap-2 border-l-2 border-blush-soft pl-3">
                    {product.options.map((option) => (
                      <fieldset key={option.id}>
                        <legend className="mb-1.5 text-xs font-semibold text-ink">
                          {option.name}
                          {option.required && <span className="ml-1 text-rose-deep">*</span>}
                          {/* Several lines can each show a "Size" group, so name
                              the treat for screen readers without repeating it
                              on screen. */}
                          <span className="sr-only"> for {product.name}</span>
                        </legend>
                        <div className="flex flex-wrap gap-1.5">
                          {option.values.map((value) => {
                            const isSelected = line.chosen[option.id] === value.id;
                            const disabled = value.isAvailable === false;
                            return (
                              <button
                                key={value.id}
                                type="button"
                                disabled={disabled}
                                aria-pressed={isSelected}
                                onClick={() => setChoice(index, option.id, value.id)}
                                className={cn(
                                  "rounded-full border px-3 py-1.5 text-sm font-semibold transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-50",
                                  isSelected
                                    ? "border-rose-deep bg-blush-soft text-ink"
                                    : "border-line bg-white text-ink hover:border-rose",
                                )}
                              >
                                {value.label}
                                {value.priceDeltaCents > 0 && (
                                  <span className="ml-1 text-muted">
                                    +{formatPrice(value.priceDeltaCents)}
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </fieldset>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          <button
            type="button"
            onClick={() => setLines((prev) => [...prev, newLine(available[0])])}
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
              disabled={busy || lines.length === 0 || missingChoice || soldOutChoice}
              className="rounded-full bg-rose-deep px-5 py-2 text-sm font-semibold text-white transition hover:brightness-110 active:scale-95 disabled:opacity-60"
            >
              {busy
                ? "Adding…"
                : soldOutChoice
                  ? "Flavour sold out"
                  : missingChoice
                    ? "Choose an option"
                    : "Add to my order"}
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
