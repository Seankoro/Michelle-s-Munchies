"use client";

import { useMemo } from "react";
import { useAdmin } from "@/components/admin/AdminStore";
import { PanelLoading } from "@/components/admin/PanelLoading";
import { formatLongDate, toISODate, windowRank } from "@/lib/order";
import { buildOrdersIcs } from "@/lib/ics";
import { useTickList } from "@/lib/useTickList";
import { cn } from "@/lib/cn";

export default function AdminBakeListPage() {
  const { orders, hydrated, settings } = useAdmin();
  const { has, toggle, clear } = useTickList("mm-bake-ticks");

  // What still needs baking, grouped by fulfillment date. Sizes and options are
  // kept separate, since a box of 6 and a box of 12 are different bakes.
  //
  // Only the statuses that still need an oven. Ready means baked and boxed, and
  // out for delivery means it has already left, so counting either told her to
  // bake a second one. Two orders for the same treat collapse into one line
  // here, and the tick is all or nothing, so she could not even tick off the
  // half that was done.
  const days = useMemo(() => {
    const active = orders.filter(
      (o) => o.status === "received" || o.status === "confirmed" || o.status === "baking",
    );
    const byDate = new Map<
      string,
      {
        orderCount: number;
        items: Map<string, { label: string; qty: number }>;
        windows: Set<string>;
      }
    >();

    for (const order of active) {
      const day =
        byDate.get(order.scheduledDate) ??
        { orderCount: 0, items: new Map(), windows: new Set<string>() };
      day.orderCount += 1;
      if (order.timeWindow) day.windows.add(order.timeWindow);
      for (const item of order.items) {
        const opts = item.selectedOptions.map((o) => o.valueLabel).join(", ");
        const label = opts ? `${item.name} (${opts})` : item.name;
        const entry = day.items.get(label) ?? { label, qty: 0 };
        entry.qty += item.quantity;
        day.items.set(label, entry);
      }
      byDate.set(order.scheduledDate, day);
    }

    // Order each day's windows by the owner's own list, so the sequence reads
    // earliest-slot-first: what has to come out of the oven soonest.
    return [...byDate.entries()]
      .sort((a, b) => a[0].localeCompare(b[0])) // soonest first
      .map(([date, day]) => ({
        date,
        orderCount: day.orderCount,
        windows: [...day.windows].sort(
          (a, b) => windowRank(settings.timeWindows, a) - windowRank(settings.timeWindows, b),
        ),
        items: [...day.items.values()].sort((x, y) => x.label.localeCompare(y.label)),
      }));
  }, [orders, settings.timeWindows]);

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

  // Print a single day's sheet. The print stylesheet hides everything but the
  // section that briefly carries `print-only-target`.
  function printDay(date: string) {
    const el = document.getElementById(`bake-${date}`);
    if (!el) return;
    el.classList.add("print-only-target");
    const cleanup = () => {
      el.classList.remove("print-only-target");
      window.removeEventListener("afterprint", cleanup);
    };
    window.addEventListener("afterprint", cleanup);
    window.print();
  }

  return (
    <div className="max-w-2xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold">Bake list</h1>
          <p className="mt-1 text-muted">
            Everything still to make, by day. Tick items off as you bake, they stay ticked.
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
        <PanelLoading />
      ) : days.length === 0 ? (
        <p className="mt-8 rounded-2xl border border-line bg-white p-6 text-muted">
          Nothing to bake right now. New orders will show up here.
        </p>
      ) : (
        <div className="mt-6 flex flex-col gap-5">
          {days.map((day) => {
            const keys = day.items.map((item) => `${day.date}::${item.label}`);
            const doneCount = keys.filter((key) => has(key)).length;
            return (
              <section
                key={day.date}
                id={`bake-${day.date}`}
                className="rounded-2xl border border-line bg-white p-5"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <h2 className="font-display text-lg font-semibold">{formatLongDate(day.date)}</h2>
                  <span className="text-sm text-muted">
                    {day.orderCount} {day.orderCount === 1 ? "order" : "orders"}
                    {doneCount > 0 && ` · ${doneCount}/${day.items.length} done`}
                  </span>
                </div>
                {day.windows.length > 0 && (
                  <p className="mt-1 text-xs font-semibold text-rose-ink">
                    {day.windows.length > 1
                      ? `Bake order: ${day.windows.join(" → ")}`
                      : `Due: ${day.windows[0]}`}
                  </p>
                )}
                <div className="mt-1 flex items-center gap-4 print-hide">
                  {doneCount > 0 && (
                    <button
                      type="button"
                      onClick={() => clear(keys)}
                      className="text-xs font-semibold text-rose-ink transition hover:text-rose"
                    >
                      Reset ticks
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => printDay(day.date)}
                    className="text-xs font-semibold text-muted transition hover:text-ink"
                  >
                    🖨 Print this day
                  </button>
                </div>
                <ul className="mt-3 flex flex-col gap-2 text-sm">
                  {day.items.map((item) => {
                    const key = `${day.date}::${item.label}`;
                    const done = has(key);
                    return (
                      <li key={item.label} className="flex items-center justify-between gap-3">
                        <label className="flex cursor-pointer items-center gap-2">
                          <input
                            type="checkbox"
                            checked={done}
                            onChange={() => toggle(key)}
                            className="h-4 w-4 shrink-0 accent-rose-deep"
                          />
                          <span className={cn(done && "text-muted line-through")}>{item.label}</span>
                        </label>
                        <span className={cn("font-semibold", done && "text-muted")}>× {item.qty}</span>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
