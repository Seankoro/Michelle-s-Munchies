"use client";

import { useMemo } from "react";
import { useAdmin } from "@/components/admin/AdminStore";
import { formatPrice } from "@/lib/catalog";
import { cn } from "@/lib/cn";

export default function AdminAnalyticsPage() {
  const { orders, hydrated } = useAdmin();

  const a = useMemo(() => {
    const paid = orders.filter((o) => o.paymentStatus === "paid");
    const revenue = paid.reduce((sum, o) => sum + o.totalCents, 0);
    const orderCount = paid.length;
    const aov = orderCount > 0 ? Math.round(revenue / orderCount) : 0;

    const cutoff = Date.now() - 30 * 86_400_000;
    const revenue30 = paid
      .filter((o) => new Date(o.createdAt).getTime() >= cutoff)
      .reduce((sum, o) => sum + o.totalCents, 0);

    // Top products by quantity sold across paid orders, using order snapshots.
    const byProduct = new Map<string, { name: string; qty: number; revenueCents: number }>();
    for (const order of paid) {
      for (const item of order.items) {
        const entry = byProduct.get(item.name) ?? { name: item.name, qty: 0, revenueCents: 0 };
        entry.qty += item.quantity;
        entry.revenueCents += item.unitPriceCents * item.quantity;
        byProduct.set(item.name, entry);
      }
    }
    const topProducts = [...byProduct.values()].sort((x, y) => y.qty - x.qty).slice(0, 8);
    const maxQty = Math.max(1, ...topProducts.map((p) => p.qty));

    // Revenue for each of the last 7 days, by paid order.
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(Date.now() - (6 - i) * 86_400_000);
      const key = d.toISOString().slice(0, 10);
      const cents = paid
        .filter((o) => o.createdAt.slice(0, 10) === key)
        .reduce((sum, o) => sum + o.totalCents, 0);
      return {
        key,
        label: new Date(key).toLocaleDateString("en-SG", { weekday: "short" }),
        cents,
      };
    });
    const maxDay = Math.max(1, ...days.map((d) => d.cents));

    return { revenue, orderCount, aov, revenue30, topProducts, maxQty, days, maxDay };
  }, [orders]);

  const cards = [
    { label: "Paid revenue (all time)", value: formatPrice(a.revenue) },
    { label: "Paid orders", value: String(a.orderCount) },
    { label: "Average order", value: formatPrice(a.aov) },
    { label: "Revenue (30 days)", value: formatPrice(a.revenue30) },
  ];

  return (
    <div>
      <h1 className="font-display text-3xl font-semibold">Insights</h1>
      <p className="mt-1 text-muted">How the bakery is doing. Counts paid orders only.</p>

      {!hydrated ? (
        null
      ) : a.orderCount === 0 ? (
        <p className="mt-8 rounded-2xl border border-line bg-white p-6 text-muted">
          No paid orders yet. Your sales insights will appear here once orders start coming in.
        </p>
      ) : (
        <>
          <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
            {cards.map((card) => (
              <div key={card.label} className="rounded-2xl border border-line bg-white p-4">
                <p className="text-sm text-muted">{card.label}</p>
                <p className="mt-1 font-display text-2xl font-semibold">{card.value}</p>
              </div>
            ))}
          </div>

          {/* Last 7 days */}
          <section className="mt-8 rounded-2xl border border-line bg-white p-5">
            <h2 className="font-display text-lg font-semibold">Revenue · last 7 days</h2>
            <div className="mt-5 flex h-40 items-end justify-between gap-2">
              {a.days.map((day) => (
                <div key={day.key} className="flex flex-1 flex-col items-center gap-2">
                  <span className="text-xs font-semibold text-muted">
                    {day.cents > 0 ? formatPrice(day.cents) : ""}
                  </span>
                  <div className="flex w-full flex-1 items-end">
                    <div
                      className={cn(
                        "w-full rounded-t-lg transition-all",
                        day.cents > 0 ? "bg-rose-deep/80" : "bg-marble",
                      )}
                      style={{ height: `${Math.max(2, (day.cents / a.maxDay) * 100)}%` }}
                    />
                  </div>
                  <span className="text-xs text-muted">{day.label}</span>
                </div>
              ))}
            </div>
          </section>

          {/* Top products */}
          <section className="mt-6 rounded-2xl border border-line bg-white p-5">
            <h2 className="font-display text-lg font-semibold">Best sellers</h2>
            <p className="mt-1 text-sm text-muted">By quantity sold across paid orders.</p>
            <ul className="mt-4 flex flex-col gap-3">
              {a.topProducts.map((product, index) => (
                <li key={product.name} className="flex items-center gap-3">
                  <span className="w-5 text-sm font-semibold text-muted">{index + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="truncate font-semibold">{product.name}</span>
                      <span className="shrink-0 text-sm text-muted">
                        {product.qty} sold · {formatPrice(product.revenueCents)}
                      </span>
                    </div>
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-marble">
                      <div
                        className="h-full rounded-full bg-rose-deep/70"
                        style={{ width: `${(product.qty / a.maxQty) * 100}%` }}
                      />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
