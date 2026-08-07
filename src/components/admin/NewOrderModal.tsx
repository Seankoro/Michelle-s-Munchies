"use client";

import { useMemo, useState } from "react";
import { useAdmin } from "@/components/admin/AdminStore";
import { AdminModal } from "@/components/admin/AdminModal";
import { formatPrice } from "@/lib/catalog";
import { compactInputClass as inputClass } from "@/lib/ui";
import { cn } from "@/lib/cn";
import type { Product, ProductOptionValue, SelectedOption } from "@/lib/types";

type Line = {
  /** Empty on a custom line, which is off-catalogue by definition. */
  productId: string;
  quantity: number;
  /** Chosen value id per option group id, the same shape the storefront keeps. */
  choices: Record<string, string>;
  /** Present only on a custom line: the wording and the price agreed on WhatsApp. */
  custom?: { name: string; priceText: string };
};

/** One line resolved to exactly what gets written on the order. */
type PricedLine = {
  productId: string;
  name: string;
  unitPriceCents: number;
  quantity: number;
  selectedOptions: SelectedOption[];
  /** Name of a required group with nothing picked, so submit can refuse. */
  missingOption: string | null;
};

/**
 * Pre-pick the first in-stock value of every group, the same way the storefront
 * picker does, so the usual case stays one tap and a required size is never
 * quietly left empty.
 */
function defaultChoices(product: Product | undefined): Record<string, string> {
  const choices: Record<string, string> = {};
  for (const option of product?.options ?? []) {
    const first = option.values.find((v) => v.isAvailable !== false) ?? option.values[0];
    if (first) choices[option.id] = first.id;
  }
  return choices;
}

/**
 * One choice as a single string: the label, what it adds, and a sold-out marker.
 * Sold out is a warning here rather than a block, because Michelle has already
 * agreed to bake whatever the customer asked for on WhatsApp.
 */
function valueLabel(value: ProductOptionValue): string {
  const delta = value.priceDeltaCents > 0 ? ` +${formatPrice(value.priceDeltaCents)}` : "";
  const soldOut = value.isAvailable === false ? " (sold out)" : "";
  return `${value.label}${delta}${soldOut}`;
}

/**
 * Log an order taken over WhatsApp or the phone. It becomes a real order, so it
 * shows in the list and flows into the bake list, packing slips, and Insights.
 * Items are picked from the live catalogue with their sizes and flavours, priced
 * base plus the chosen deltas exactly like the storefront, and anything the
 * catalogue can't express goes on a custom line with its agreed amount. Payment
 * starts pending, to be marked paid once PayNow lands.
 */
export function NewOrderModal({ onClose }: { onClose: () => void }) {
  const { products, settings, orders, addManualOrder } = useAdmin();

  const available = useMemo(() => products.filter((p) => p.isAvailable), [products]);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [fulfillment, setFulfillment] = useState<"pickup" | "delivery">("pickup");
  const [date, setDate] = useState("");
  const [timeWindow, setTimeWindow] = useState(settings.timeWindows[0] ?? "");
  const [line1, setLine1] = useState("");
  const [unit, setUnit] = useState("");
  const [postal, setPostal] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>(() =>
    available[0]
      ? [{ productId: available[0].id, quantity: 1, choices: defaultChoices(available[0]) }]
      : [],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Price every line the way the storefront does: base plus each chosen value's
  // delta, with the chosen labels carried onto the order so the bake list and
  // the packing slip say which size to make. A custom line carries its own
  // agreed amount, since nothing in the catalogue can price it.
  const priced: PricedLine[] = lines.flatMap((line) => {
    const custom = line.custom;
    if (custom) {
      const customName = custom.name.trim();
      if (!customName) return [];
      return [
        {
          productId: "",
          name: customName,
          unitPriceCents: Math.max(0, Math.round(parseFloat(custom.priceText || "0") * 100)),
          quantity: line.quantity,
          selectedOptions: [],
          missingOption: null,
        },
      ];
    }
    const product = available.find((p) => p.id === line.productId);
    if (!product) return [];
    const selectedOptions: SelectedOption[] = [];
    let missingOption: string | null = null;
    for (const option of product.options) {
      const value = option.values.find((v) => v.id === line.choices[option.id]);
      if (!value) {
        if (option.required && !missingOption) missingOption = option.name;
        continue;
      }
      selectedOptions.push({
        optionName: option.name,
        valueLabel: value.label,
        priceDeltaCents: value.priceDeltaCents,
      });
    }
    return [
      {
        productId: product.id,
        name: product.name,
        unitPriceCents:
          product.basePriceCents + selectedOptions.reduce((sum, o) => sum + o.priceDeltaCents, 0),
        quantity: line.quantity,
        selectedOptions,
        missingOption,
      },
    ];
  });
  const subtotalCents = priced.reduce((sum, x) => sum + x.unitPriceCents * x.quantity, 0);

  // Warn (never block) when logging onto a blackout day or an over-cap day, so
  // Michelle can still override for a special case but is not caught out.
  const dayWarning = (() => {
    if (!date) return null;
    if (settings.blackoutDates.includes(date)) return "this date is one of your blackout days";
    if (settings.dailyOrderCap && settings.dailyOrderCap > 0) {
      const count = orders.filter(
        (o) => o.status !== "cancelled" && o.scheduledDate === date,
      ).length;
      if (count >= settings.dailyOrderCap) {
        return `this day is already at your cap of ${settings.dailyOrderCap} orders`;
      }
    }
    return null;
  })();

  function setLine(index: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  async function submit() {
    setError("");
    if (lines.some((l) => l.custom && !l.custom.name.trim())) {
      setError("Name the custom item, or remove that line.");
      return;
    }
    // A required size or flavour has to be on the order. There is no screen that
    // can edit a line afterwards, and Michelle bakes what the line says.
    const unanswered = priced.find((x) => x.missingOption !== null);
    if (unanswered?.missingOption) {
      setError(`Choose a ${unanswered.missingOption} for ${unanswered.name}.`);
      return;
    }
    const items = priced.map((x) => ({
      productId: x.productId,
      name: x.name,
      unitPriceCents: x.unitPriceCents,
      quantity: x.quantity,
      selectedOptions: x.selectedOptions,
    }));
    if (items.length === 0) {
      setError("Add at least one item.");
      return;
    }
    if (fulfillment === "delivery") {
      if (!line1.trim()) {
        setError("Add the delivery address.");
        return;
      }
      if (!/^\d{6}$/.test(postal.trim())) {
        setError("Postal code must be 6 digits.");
        return;
      }
    }
    setBusy(true);
    const result = await addManualOrder({
      items,
      fulfillmentType: fulfillment,
      scheduledDate: date,
      timeWindow,
      name,
      phone,
      email,
      notes,
      address:
        fulfillment === "delivery"
          ? { line1, unit: unit.trim() || undefined, postalCode: postal }
          : undefined,
    });
    setBusy(false);
    if (result.ok) onClose();
    else setError(result.error);
  }

  return (
    <AdminModal
      onClose={onClose}
      ariaLabel="Log a new order"
      panelClassName="flex max-h-[90dvh] w-full max-w-lg animate-[fade-up_0.2s_ease-out] flex-col rounded-t-2xl bg-white shadow-soft sm:rounded-2xl"
    >
        {/* Fixed header so the close button stays reachable while the form scrolls. */}
        <div className="flex items-start justify-between gap-4 rounded-t-2xl border-b border-line bg-white px-6 py-4">
          <div>
            <h2 className="font-display text-xl font-semibold">Log an order</h2>
            <p className="text-sm text-muted">For an order taken on WhatsApp or the phone.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted transition hover:bg-blush-soft active:scale-90"
          >
            ✕
          </button>
        </div>

        <div className="flex flex-col gap-4 overflow-y-auto px-6 py-5">
          <label className="flex flex-col gap-1 text-sm font-semibold">
            Customer name
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Phone
              <input
                className={inputClass}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Optional"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Email
              <input
                className={inputClass}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Optional"
              />
            </label>
          </div>

          {/* Items */}
          <div>
            <p className="text-sm font-semibold">Items</p>
            <div className="mt-2 flex flex-col gap-3">
              {lines.map((line, index) => {
                const custom = line.custom;
                const product = custom
                  ? undefined
                  : available.find((p) => p.id === line.productId);
                return (
                  <div key={index} className="flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      {custom ? (
                        <input
                          className={cn(inputClass, "flex-1")}
                          value={custom.name}
                          onChange={(e) =>
                            setLine(index, {
                              custom: { name: e.target.value, priceText: custom.priceText },
                            })
                          }
                          placeholder="Custom item, e.g. 8 inch birthday cake"
                          aria-label="Custom item"
                        />
                      ) : (
                        <select
                          value={line.productId}
                          onChange={(e) => {
                            // Option ids belong to the product, so start the new
                            // one on its own defaults rather than carrying the
                            // previous product's picks across.
                            const next = available.find((p) => p.id === e.target.value);
                            setLine(index, {
                              productId: e.target.value,
                              choices: defaultChoices(next),
                            });
                          }}
                          className={cn(inputClass, "flex-1")}
                        >
                          {available.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name} · {formatPrice(p.basePriceCents)}
                            </option>
                          ))}
                        </select>
                      )}
                      <input
                        type="number"
                        min={1}
                        value={line.quantity}
                        onChange={(e) =>
                          setLine(index, {
                            quantity: Math.max(1, parseInt(e.target.value || "1", 10)),
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

                    {custom && (
                      <label className="flex items-center gap-2 pl-1 text-xs font-semibold text-muted">
                        Price each
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          className={cn(inputClass, "w-28 sm:text-sm")}
                          value={custom.priceText}
                          onChange={(e) =>
                            setLine(index, {
                              custom: { name: custom.name, priceText: e.target.value },
                            })
                          }
                          placeholder="0.00"
                          aria-label="Custom item price"
                        />
                      </label>
                    )}

                    {product?.options.map((option) => (
                      <label
                        key={option.id}
                        className="flex items-center gap-2 pl-1 text-xs font-semibold text-muted"
                      >
                        <span>
                          {option.name}
                          {option.required && <span className="text-rose-ink"> *</span>}
                        </span>
                        <select
                          className={cn(inputClass, "flex-1 sm:text-sm")}
                          value={line.choices[option.id] ?? ""}
                          onChange={(e) =>
                            setLine(index, {
                              choices: { ...line.choices, [option.id]: e.target.value },
                            })
                          }
                        >
                          {/* An optional group can genuinely be left off an order. */}
                          {!option.required && <option value="">None</option>}
                          {option.values.map((value) => (
                            <option key={value.id} value={value.id}>
                              {valueLabel(value)}
                            </option>
                          ))}
                        </select>
                      </label>
                    ))}
                  </div>
                );
              })}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() =>
                  setLines((prev) => [
                    ...prev,
                    {
                      productId: available[0]?.id ?? "",
                      quantity: 1,
                      choices: defaultChoices(available[0]),
                    },
                  ])
                }
                disabled={available.length === 0}
                className="rounded-full border border-line px-4 py-1.5 text-sm font-semibold transition hover:border-rose active:scale-95 disabled:opacity-50"
              >
                + Add item
              </button>
              <button
                type="button"
                onClick={() =>
                  setLines((prev) => [
                    ...prev,
                    { productId: "", quantity: 1, choices: {}, custom: { name: "", priceText: "" } },
                  ])
                }
                className="rounded-full border border-line px-4 py-1.5 text-sm font-semibold transition hover:border-rose active:scale-95"
              >
                + Custom item
              </button>
            </div>
          </div>

          {/* Fulfilment */}
          <div className="flex flex-col gap-2">
            <span className="text-sm font-semibold">Fulfilment</span>
            <div className="inline-flex rounded-full border border-line bg-white p-1 text-sm font-semibold">
              {(["pickup", "delivery"] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setFulfillment(type)}
                  aria-pressed={fulfillment === type}
                  className={cn(
                    "rounded-full px-4 py-1.5 capitalize transition",
                    fulfillment === type ? "bg-rose-deep text-white" : "text-muted hover:text-ink",
                  )}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>

          {fulfillment === "delivery" && (
            <div className="flex flex-col gap-3 rounded-2xl bg-marble/40 p-3">
              <label className="flex flex-col gap-1 text-sm font-semibold">
                Address
                <input
                  className={inputClass}
                  value={line1}
                  onChange={(e) => setLine1(e.target.value)}
                  placeholder="Block and street"
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <input
                  className={inputClass}
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                  placeholder="Unit (optional)"
                  aria-label="Unit"
                />
                <input
                  className={inputClass}
                  value={postal}
                  onChange={(e) => setPostal(e.target.value)}
                  placeholder="Postal code"
                  inputMode="numeric"
                  aria-label="Postal code"
                />
              </div>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Date
              <input
                type="date"
                className={inputClass}
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Time window
              <select
                className={inputClass}
                value={timeWindow}
                onChange={(e) => setTimeWindow(e.target.value)}
              >
                {settings.timeWindows.map((window) => (
                  <option key={window} value={window}>
                    {window}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {dayWarning && (
            <p role="status" className="rounded-xl bg-warning-soft px-3 py-2 text-sm text-warning-ink">
              Heads up: {dayWarning}. You can still log it.
            </p>
          )}

          <label className="flex flex-col gap-1 text-sm font-semibold">
            Notes
            <textarea
              className={cn(inputClass, "min-h-16 resize-y")}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Anything to remember, flavours, allergies, message"
            />
          </label>

          <div className="flex items-center justify-between border-t border-line pt-4">
            <span className="text-sm text-muted">
              Total{" "}
              <span className="font-display text-lg font-semibold text-ink">
                {formatPrice(subtotalCents)}
              </span>
              {fulfillment === "delivery" && " + delivery"}
            </span>
            <button
              type="button"
              onClick={submit}
              disabled={busy}
              className="rounded-full bg-rose-deep px-6 py-2.5 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:brightness-110 active:scale-95 disabled:opacity-60"
            >
              {busy ? "Saving…" : "Log order"}
            </button>
          </div>
          {error && <p className="text-sm text-rose-ink">{error}</p>}
        </div>
    </AdminModal>
  );
}
