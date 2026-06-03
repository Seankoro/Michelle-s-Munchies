"use client";

import { useMemo } from "react";
import { useAdmin } from "@/components/admin/AdminStore";
import { formatLongDate, toISODate } from "@/lib/order";
import { buildOrdersIcs } from "@/lib/ics";

export default function AdminBakeListPage() {
  const { orders, hydrated } = useAdmin();

  // What still needs baking, grouped by fulfillment date. Completed and
  // cancelled orders drop off; sizes/options are kept separate (a box of 6 and a
  // box of 12 are different bakes).
  const days = useMemo(() => {
    const active = orders.filter(
      (o) => o.status !== "completed" && o.status !== "cancelled",
    );
    const byDate = new Map<
      string,
      { orderCount: number; items: Map<string, { label: string; qty: number }> }
    >();

    for (const order of active) {
      const day = byDate.get(order.scheduledDate) ?? { orderCount: 0, items: new Map() };
      day.orderCount += 1;
      for (const item of order.items) {
        const opts = item.selectedOptions.map((o) => o.valueLabel).join(", ");
        const label = opts ? `${item.name} (${opts})` : item.name;
        const entry = day.items.get(label) ?? { label, qty: 0 };
        entry.qty += item.quantity;
        day.items.set(label, entry);
      }
      byDate.set(order.scheduledDate, day);
    }

    return [...byDate.entries()]
      .sort((a, b) => a[0].localeCompare(b[0])) // soonest first
      .map(([date, day]) => ({
        date,
        orderCount: day.orderCount,
        items: [...day.items.values()].sort((x, y) => x.label.localeCompare(y.label)),
      }));
  }, [orders]);

  function exportCalendar() {
    const today = toISODate(new Date());
    const upcoming = orders
      .filter((o) => o.status !== "cancelled" && o.scheduledDate >= today)
      .map((o) => ({
        orderNumber: o.orderNumber,
        scheduledDate: o.scheduledDate,
        timeWindow: o.timeWindow ?? null,
        itemSummary: `${o.items.reduce((n, i) => n + i.quantity, 0)} items`,
      }));
    const ics = buildOrdersIcs(upcoming);
    const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "michelles-munchies-orders.ics";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="max-w-2xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold">Bake list</h1>
          <p className="mt-1 text-muted">
            Everything still to make, by day. Completed and cancelled orders are excluded.
          </p>
        </div>
        <button
          type="button"
          onClick={exportCalendar}
          className="rounded-full border border-line px-4 py-2 text-sm font-semibold transition hover:border-rose active:scale-95"
        >
          Export to calendar
        </button>
      </div>

      {!hydrated ? (
        null
      ) : days.length === 0 ? (
        <p className="mt-8 rounded-2xl border border-line bg-white p-6 text-muted">
          Nothing to bake right now. New orders will show up here.
        </p>
      ) : (
        <div className="mt-6 flex flex-col gap-5">
          {days.map((day) => (
            <section key={day.date} className="rounded-2xl border border-line bg-white p-5">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="font-display text-lg font-semibold">{formatLongDate(day.date)}</h2>
                <span className="text-sm text-muted">
                  {day.orderCount} {day.orderCount === 1 ? "order" : "orders"}
                </span>
              </div>
              <ul className="mt-3 flex flex-col gap-2 text-sm">
                {day.items.map((item) => (
                  <li key={item.label} className="flex items-center justify-between gap-3">
                    <span>{item.label}</span>
                    <span className="font-semibold">× {item.qty}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
