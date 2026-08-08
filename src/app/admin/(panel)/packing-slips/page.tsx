"use client";

import { useMemo } from "react";
import { useAdmin } from "@/components/admin/AdminStore";
import { PanelLoading } from "@/components/admin/PanelLoading";
import { singaporeDateString } from "@/lib/time";
import { allergenMeta } from "@/lib/catalog";
import { formatLongDate } from "@/lib/order";

export default function AdminPackingSlipsPage() {
  const { orders, products, hydrated } = useAdmin();

  // Product name → allergen labels, so each slip can flag allergens per item.
  const allergensByName = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const p of products) {
      map.set(
        p.name,
        p.allergens.map((a) => allergenMeta[a].label),
      );
    }
    return map;
  }, [products]);

  const days = useMemo(() => {
    // Only orders that still need packing: not cancelled, not completed, and
    // scheduled today (Singapore time) or later, so Print never outputs history.
    const today = singaporeDateString();
    const active = orders.filter(
      (o) => o.status !== "cancelled" && o.status !== "completed" && o.scheduledDate >= today,
    );
    const byDate = new Map<string, typeof active>();
    for (const order of active) {
      const list = byDate.get(order.scheduledDate) ?? [];
      list.push(order);
      byDate.set(order.scheduledDate, list);
    }
    return [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [orders]);

  if (!hydrated) return <PanelLoading />;

  return (
    <div className="max-w-3xl">
      <style>{`@media print {
        .no-print { display: none !important; }
        .slip { break-inside: avoid; }
        .slip-day { break-before: page; }
        .slip-day:first-of-type { break-before: auto; }
      }`}</style>

      <div className="no-print flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-semibold">Packing slips</h1>
          <p className="mt-1 text-muted">One slip per order, grouped by day. Allergens flagged per item.</p>
        </div>
        <button
          type="button"
          onClick={() => window.print()}
          className="rounded-full bg-rose-deep px-4 py-2 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:brightness-110 active:scale-95"
        >
          Print
        </button>
      </div>

      {days.length === 0 ? (
        <p className="mt-8 rounded-2xl border border-line bg-white p-6 text-muted">No orders to pack.</p>
      ) : (
        <div className="mt-6 flex flex-col gap-8">
          {days.map(([date, dayOrders]) => (
            <section key={date} className="slip-day">
              <h2 className="font-display text-2xl font-semibold">{formatLongDate(date)}</h2>
              <div className="mt-3 flex flex-col gap-4">
                {dayOrders.map((order) => (
                  <article
                    key={order.orderNumber}
                    className="slip rounded-2xl border border-line bg-white p-5"
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-semibold">{order.orderNumber}</span>
                      <span className="text-sm text-muted">
                        {order.fulfillmentType === "pickup" ? "Pickup" : "Delivery"}
                        {order.timeWindow ? ` · ${order.timeWindow}` : " · no time set"}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-muted">
                      {order.name} · {order.phone}
                      {order.fulfillmentType === "delivery" && order.address && (
                        <>
                          {" "}
                          · {order.address.line1}
                          {order.address.unit ? `, #${order.address.unit}` : ""} S(
                          {order.address.postalCode})
                        </>
                      )}
                    </p>
                    {/* A delivery with no address printed as a blank tail on the
                        line above, which reads like an address that just did not
                        fit. The slip is what goes out with the box, so say it in
                        words that cannot be walked past. */}
                    {order.fulfillmentType === "delivery" && !order.address && (
                      <p className="mt-2 rounded-lg border-2 border-danger bg-danger-soft px-3 py-2 text-sm font-bold uppercase text-danger-ink">
                        ⚠ No address yet, do not pack. Get it from the customer and add it to the
                        order first.
                      </p>
                    )}
                    {order.isGift && (
                      <p className="mt-1 text-sm font-semibold text-rose-ink">
                        🎁 Gift{order.recipientName ? ` for ${order.recipientName}` : ""}. Include a card, no receipt
                      </p>
                    )}
                    <ul className="mt-3 flex flex-col gap-1.5 text-sm">
                      {order.items.map((item, index) => {
                        const opts = item.selectedOptions.map((o) => o.valueLabel).join(", ");
                        const allergens = allergensByName.get(item.name) ?? [];
                        return (
                          <li key={index} className="flex justify-between gap-3 border-b border-line/60 pb-1.5 last:border-0">
                            <span>
                              <span className="font-semibold">{item.quantity}×</span> {item.name}
                              {opts && <span className="text-muted"> ({opts})</span>}
                              {allergens.length > 0 && (
                                <span className="block text-xs text-muted">
                                  Contains: {allergens.join(", ")}
                                </span>
                              )}
                              {item.personalisation?.message && (
                                <span className="block text-xs font-semibold text-ink">
                                  ✍️ &ldquo;{item.personalisation.message}&rdquo;
                                </span>
                              )}
                              {item.personalisation?.photoUrl && (
                                <span className="block text-xs text-muted">
                                  📎 Reference photo on the order
                                </span>
                              )}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                    {order.notes && (
                      <p className="mt-3 text-sm">
                        <span className="font-semibold">Notes:</span> {order.notes}
                      </p>
                    )}
                    {/* Answers to the required checkout questions. A prompt can
                        be marked required, so this is where an allergy lands,
                        and the slip is what goes out with the box. */}
                    {(order.noteAnswers ?? []).map((answer) => (
                      <p key={answer.id} className="mt-1 text-sm">
                        <span className="font-semibold">{answer.label}:</span> {answer.answer}
                      </p>
                    ))}
                    {/* Deliberately NOT owner_note. This slip goes into the box,
                        so the customer reads whatever is on it, and that note is
                        Michelle's private line about them: "difficult customer",
                        "allergy, mother called twice". Hiding it from the
                        customer is the whole point of the column grants in
                        migration 0035, and printing it here would hand it over
                        by another route. The address correction that used to
                        need somewhere to live now has its own control on the
                        order instead. */}
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
