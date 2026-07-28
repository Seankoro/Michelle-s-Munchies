"use client";

import { useMemo, useState } from "react";
import { useAdmin } from "@/components/admin/AdminStore";
import { AdminModal } from "@/components/admin/AdminModal";
import { formatPrice } from "@/lib/catalog";
import { compactInputClass as inputClass } from "@/lib/ui";
import { cn } from "@/lib/cn";

type Line = { productId: string; quantity: number };

/**
 * Log an order taken over WhatsApp or the phone. It becomes a real order, so it
 * shows in the list and flows into the bake list, packing slips, and Insights.
 * Items are picked from the live catalogue (at base price) so prep tools resolve
 * them; payment starts pending, to be marked paid once PayNow lands.
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
    available[0] ? [{ productId: available[0].id, quantity: 1 }] : [],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const chosen = lines
    .map((line) => ({
      product: available.find((p) => p.id === line.productId),
      quantity: line.quantity,
    }))
    .filter((x): x is { product: NonNullable<typeof x.product>; quantity: number } =>
      Boolean(x.product),
    );
  const subtotalCents = chosen.reduce((sum, x) => sum + x.product.basePriceCents * x.quantity, 0);

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
    const items = chosen.map((x) => ({
      productId: x.product.id,
      name: x.product.name,
      unitPriceCents: x.product.basePriceCents,
      quantity: x.quantity,
      selectedOptions: [],
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
            <div className="mt-2 flex flex-col gap-2">
              {lines.map((line, index) => (
                <div key={index} className="flex items-center gap-2">
                  <select
                    value={line.productId}
                    onChange={(e) => setLine(index, { productId: e.target.value })}
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
                    value={line.quantity}
                    onChange={(e) =>
                      setLine(index, { quantity: Math.max(1, parseInt(e.target.value || "1", 10)) })
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
            </div>
            <button
              type="button"
              onClick={() =>
                setLines((prev) => [...prev, { productId: available[0]?.id ?? "", quantity: 1 }])
              }
              disabled={available.length === 0}
              className="mt-2 rounded-full border border-line px-4 py-1.5 text-sm font-semibold transition hover:border-rose active:scale-95 disabled:opacity-50"
            >
              + Add item
            </button>
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
          {error && <p className="text-sm text-rose-deep">{error}</p>}
        </div>
    </AdminModal>
  );
}
