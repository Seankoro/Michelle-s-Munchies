"use client";

import { useMemo, useState } from "react";
import { useAdmin } from "@/components/admin/AdminStore";
import { PanelLoading } from "@/components/admin/PanelLoading";
import { RevenueChart, type ChartPoint } from "@/components/admin/RevenueChart";
import { singaporeDateString } from "@/lib/time";
import { toISODate, type AdminOrder } from "@/lib/order";
import { formatPrice } from "@/lib/catalog";
import { cn } from "@/lib/cn";

type RangeKey = "7d" | "30d" | "thisMonth" | "lastMonth" | "90d" | "all" | "custom";

const RANGES: { key: RangeKey; label: string }[] = [
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "thisMonth", label: "This month" },
  { key: "lastMonth", label: "Last month" },
  { key: "90d", label: "3 months" },
  { key: "all", label: "All time" },
  { key: "custom", label: "Custom" },
];

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const parseDay = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const addDays = (s: string, n: number) => {
  const d = parseDay(s);
  d.setDate(d.getDate() + n);
  return toISODate(d);
};
const daysBetween = (a: string, b: string) =>
  Math.round((parseDay(b).getTime() - parseDay(a).getTime()) / 86_400_000);
const mondayOf = (s: string) => {
  const d = parseDay(s);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return toISODate(d);
};

export default function AdminAnalyticsPage() {
  const { orders, products, hydrated } = useAdmin();
  const [range, setRange] = useState<RangeKey>("30d");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [sellerBy, setSellerBy] = useState<"qty" | "revenue" | "profit">("qty");

  const a = useMemo(() => {
    const today = singaporeDateString();
    const paid = orders.filter((o) => o.paymentStatus === "paid" && o.status !== "cancelled");
    const dayOf = (iso: string) => singaporeDateString(iso);
    // Revenue belongs to the day the money arrived, not the day the order was
    // placed. Nearly every order here is a PayNow transfer that Michelle marks
    // paid days later, so bucketing by the order date put takings in the wrong
    // month and no period could be reconciled against her bank statement.
    // Orders paid before paid_at existed have none, so they fall back to the
    // order date, which is the closest honest answer available for them.
    const earnedOn = (o: AdminOrder) => dayOf(o.paidAt ?? o.createdAt);
    // What was actually kept: the total, less anything handed back on a refund
    // that did not cancel the order.
    const keptCents = (o: AdminOrder) => o.totalCents - (o.refundedCents ?? 0);
    // Cost by product name (order items snapshot the name). Only treats with a
    // cost entered contribute to margin, so profit figures are honestly partial.
    const costByName = new Map<string, number>();
    for (const p of products) {
      if (p.costCents != null) costByName.set(p.name, p.costCents);
    }

    // --- "Right now" figures, independent of the selected range ---
    const outstanding = orders.filter(
      (o) => o.paymentStatus === "pending" && o.status !== "cancelled",
    );
    // What is genuinely still owed, so a deposit already banked is not counted
    // as money yet to come in.
    const toCollectCents = outstanding.reduce(
      (s, o) => s + Math.max(0, o.totalCents - (o.depositCents ?? 0)),
      0,
    );

    const in14 = addDays(today, 14);
    const upcoming = orders.filter(
      (o) => o.status !== "cancelled" && o.scheduledDate >= today && o.scheduledDate <= in14,
    );
    const bookedCents = upcoming.reduce((s, o) => s + o.totalCents, 0);
    const lifetimeCents = paid.reduce((s, o) => s + keptCents(o), 0);

    // --- Resolve the selected range to a [start, end] window + bucket size ---
    let start: string;
    let end: string = today;
    let bucket: "day" | "week" | "month";
    const firstPaidDay = paid.length ? paid.map((o) => earnedOn(o)).sort()[0] : today;

    if (range === "7d") [start, bucket] = [addDays(today, -6), "day"];
    else if (range === "30d") [start, bucket] = [addDays(today, -29), "day"];
    else if (range === "thisMonth") [start, bucket] = [`${today.slice(0, 7)}-01`, "day"];
    else if (range === "lastMonth") {
      const firstThis = `${today.slice(0, 7)}-01`;
      end = addDays(firstThis, -1);
      start = `${end.slice(0, 7)}-01`;
      bucket = "day";
    } else if (range === "90d") [start, bucket] = [addDays(today, -89), "week"];
    else if (range === "all") [start, bucket] = [firstPaidDay, "month"];
    else {
      // custom: default to last 30 days until both dates are chosen
      start = customStart || addDays(today, -29);
      end = customEnd || today;
      if (start > end) [start, end] = [end, start];
      const span = daysBetween(start, end);
      bucket = span <= 45 ? "day" : span <= 200 ? "week" : "month";
    }

    // --- Build the chart buckets across the window ---
    const bucketKey = (day: string) =>
      bucket === "day" ? day : bucket === "week" ? mondayOf(day) : day.slice(0, 7);

    const buckets: { key: string; label: string; showLabel: boolean; value: number }[] = [];
    if (bucket === "month") {
      let [y, m] = start.slice(0, 7).split("-").map(Number);
      const [ey, em] = end.slice(0, 7).split("-").map(Number);
      while ((y < ey || (y === ey && m <= em)) && buckets.length < 36) {
        const key = `${y}-${String(m).padStart(2, "0")}`;
        buckets.push({
          key,
          label: new Date(y, m - 1, 1).toLocaleDateString("en-SG", { month: "short", year: "2-digit" }),
          showLabel: true,
          value: 0,
        });
        if (++m > 12) {
          m = 1;
          y++;
        }
      }
    } else {
      const step = bucket === "week" ? 7 : 1;
      let cursor = bucket === "week" ? mondayOf(start) : start;
      let i = 0;
      while (cursor <= end && buckets.length < 200) {
        const d = parseDay(cursor);
        buckets.push({
          key: cursor,
          label:
            bucket === "week"
              ? d.toLocaleDateString("en-SG", { day: "numeric", month: "short" })
              : range === "7d"
                ? d.toLocaleDateString("en-SG", { weekday: "short" })
                : String(d.getDate()),
          showLabel: bucket === "week" || range === "7d" || i % 5 === 0,
          value: 0,
        });
        cursor = addDays(cursor, step);
        i++;
      }
      // Always label the last point.
      if (buckets.length) buckets[buckets.length - 1].showLabel = true;
    }

    // Cap the x-axis to about seven evenly-strided labels (plus the last), so
    // week and month ranges never smear into an unreadable row on a narrow
    // phone. This supersedes the per-bucket hints set above.
    if (buckets.length) {
      const stride = Math.max(1, Math.ceil(buckets.length / 7));
      buckets.forEach((b, i) => {
        b.showLabel = i % stride === 0 || i === buckets.length - 1;
      });
    }
    const byKey = new Map(buckets.map((b) => [b.key, b]));

    // --- Fold paid orders into the window's buckets + range aggregates ---
    let rangeRevenue = 0;
    let rangeCount = 0;
    let pickupCents = 0;
    let deliveryCents = 0;
    const weekdayCount = new Array(7).fill(0);
    const sellers = new Map<
      string,
      { name: string; qty: number; revenueCents: number; costCents: number; hasCost: boolean }
    >();

    for (const o of paid) {
      const day = earnedOn(o);
      if (day < start || day > end) continue;
      const kept = keptCents(o);
      rangeRevenue += kept;
      rangeCount += 1;
      const b = byKey.get(bucketKey(day));
      if (b) b.value += kept;
      if (o.fulfillmentType === "delivery") deliveryCents += kept;
      else pickupCents += kept;
      weekdayCount[(parseDay(o.scheduledDate).getDay() + 6) % 7] += 1;
      for (const item of o.items) {
        const e =
          sellers.get(item.name) ??
          { name: item.name, qty: 0, revenueCents: 0, costCents: 0, hasCost: false };
        e.qty += item.quantity;
        e.revenueCents += item.unitPriceCents * item.quantity;
        const unitCost = costByName.get(item.name);
        if (unitCost != null) {
          e.costCents += unitCost * item.quantity;
          e.hasCost = true;
        }
        sellers.set(item.name, e);
      }
    }

    // --- Previous equal-length period, for the comparison delta ---
    const span = daysBetween(start, end);
    const prevEnd = addDays(start, -1);
    const prevStart = addDays(prevEnd, -span);
    let prevRevenue = 0;
    for (const o of paid) {
      const day = earnedOn(o);
      if (day >= prevStart && day <= prevEnd) prevRevenue += keptCents(o);
    }
    const deltaPct =
      prevRevenue > 0 ? Math.round(((rangeRevenue - prevRevenue) / prevRevenue) * 100) : null;

    const sellerList = [...sellers.values()].map((s) => ({
      ...s,
      profitCents: s.revenueCents - s.costCents,
    }));
    const topProducts = sellerList
      .sort((x, y) =>
        sellerBy === "qty"
          ? y.qty - x.qty
          : sellerBy === "revenue"
            ? y.revenueCents - x.revenueCents
            : y.profitCents - x.profitCents,
      )
      .slice(0, 8);
    const maxSeller = Math.max(
      1,
      ...topProducts.map((p) =>
        sellerBy === "qty" ? p.qty : sellerBy === "revenue" ? p.revenueCents : Math.max(0, p.profitCents),
      ),
    );
    // Estimated profit for the range, across treats that have a cost entered.
    const rangeProfit = sellerList
      .filter((s) => s.hasCost)
      .reduce((sum, s) => sum + s.profitCents, 0);
    const anyCost = costByName.size > 0;
    const maxWeekday = Math.max(1, ...weekdayCount);
    const points: ChartPoint[] = buckets.map((b) => ({
      label: b.label,
      value: b.value,
      showLabel: b.showLabel,
    }));

    return {
      anyOrders: orders.length > 0,
      toCollectCents,
      toCollectCount: outstanding.length,
      bookedCents,
      bookedCount: upcoming.length,
      lifetimeCents,
      rangeRevenue,
      rangeCount,
      aov: rangeCount > 0 ? Math.round(rangeRevenue / rangeCount) : 0,
      deltaPct,
      points,
      pickupCents,
      deliveryCents,
      weekdayCount,
      maxWeekday,
      topProducts,
      maxSeller,
      rangeProfit,
      anyCost,
      windowLabel: `${parseDay(start).toLocaleDateString("en-SG", { day: "numeric", month: "short" })} – ${parseDay(end).toLocaleDateString("en-SG", { day: "numeric", month: "short" })}`,
    };
  }, [orders, products, range, customStart, customEnd, sellerBy]);

  if (!hydrated) return <PanelLoading />;

  const splitTotal = a.pickupCents + a.deliveryCents;

  return (
    <div>
      <h1 className="font-display text-3xl font-semibold">Insights</h1>
      <p className="mt-1 text-muted">How the bakery is doing.</p>

      {!a.anyOrders ? (
        <p className="mt-8 rounded-2xl border border-line bg-white p-6 text-muted">
          No orders yet. Your sales insights will appear here once orders start coming in.
        </p>
      ) : (
        <>
          {/* Right now: the actionable money, always current */}
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="rounded-2xl border border-warning/40 bg-warning-soft/50 p-4">
              <p className="text-sm font-semibold text-warning-ink">To collect</p>
              <p className="mt-1 font-display text-2xl font-semibold text-ink">
                {formatPrice(a.toCollectCents)}
              </p>
              <p className="text-sm text-muted">
                {a.toCollectCount} order{a.toCollectCount === 1 ? "" : "s"} awaiting PayNow
              </p>
            </div>
            <div className="rounded-2xl border border-line bg-white p-4">
              <p className="text-sm font-semibold text-muted">Booked next 14 days</p>
              <p className="mt-1 font-display text-2xl font-semibold text-ink">
                {formatPrice(a.bookedCents)}
              </p>
              <p className="text-sm text-muted">
                {a.bookedCount} order{a.bookedCount === 1 ? "" : "s"} to bake
              </p>
            </div>
            <div className="rounded-2xl border border-line bg-white p-4">
              <p className="text-sm font-semibold text-muted">Lifetime revenue</p>
              <p className="mt-1 font-display text-2xl font-semibold text-ink">
                {formatPrice(a.lifetimeCents)}
              </p>
              <p className="text-sm text-muted">paid orders, all time</p>
            </div>
          </div>

          {/* Range selector drives everything below */}
          <div className="mt-8 flex flex-wrap gap-2">
            {RANGES.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => setRange(option.key)}
                aria-pressed={range === option.key}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-sm font-semibold transition active:scale-95",
                  range === option.key
                    ? "border-rose-deep bg-blush-soft text-ink"
                    : "border-line bg-white text-ink hover:border-rose",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
          {range === "custom" && (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              <label className="flex items-center gap-2">
                <span className="text-muted">From</span>
                <input
                  type="date"
                  value={customStart}
                  max={customEnd || undefined}
                  onChange={(e) => setCustomStart(e.target.value)}
                  className="rounded-xl border border-line bg-white px-3 py-2 text-base focus:border-rose sm:text-sm"
                />
              </label>
              <label className="flex items-center gap-2">
                <span className="text-muted">to</span>
                <input
                  type="date"
                  value={customEnd}
                  min={customStart || undefined}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  className="rounded-xl border border-line bg-white px-3 py-2 text-base focus:border-rose sm:text-sm"
                />
              </label>
            </div>
          )}

          {/* Range-driven headline cards */}
          <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-3">
            <div className="rounded-2xl border border-line bg-white p-4">
              <p className="text-sm text-muted">Revenue</p>
              <p className="mt-1 font-display text-2xl font-semibold">{formatPrice(a.rangeRevenue)}</p>
              {a.deltaPct != null ? (
                <p
                  className={cn(
                    "text-sm font-semibold",
                    a.deltaPct >= 0 ? "text-success" : "text-danger",
                  )}
                >
                  {a.deltaPct >= 0 ? "▲" : "▼"} {Math.abs(a.deltaPct)}% vs previous period
                </p>
              ) : (
                <p className="text-sm text-muted">no prior period to compare</p>
              )}
            </div>
            <div className="rounded-2xl border border-line bg-white p-4">
              <p className="text-sm text-muted">Paid orders</p>
              <p className="mt-1 font-display text-2xl font-semibold">{a.rangeCount}</p>
              <p className="text-sm text-muted">{a.windowLabel}</p>
            </div>
            <div className="col-span-2 rounded-2xl border border-line bg-white p-4 lg:col-span-1">
              <p className="text-sm text-muted">Average order</p>
              <p className="mt-1 font-display text-2xl font-semibold">{formatPrice(a.aov)}</p>
              <p className="text-sm text-muted">in this range</p>
            </div>
          </div>

          {/* Revenue chart */}
          <section className="mt-6 rounded-2xl border border-line bg-white p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="font-display text-lg font-semibold">Revenue</h2>
              <span className="text-sm text-muted">tap or hover for daily figures</span>
            </div>
            <div className="mt-4">
              <RevenueChart points={a.points} />
            </div>
          </section>

          {/* Demand cuts */}
          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
            <section className="rounded-2xl border border-line bg-white p-5">
              <h2 className="font-display text-lg font-semibold">Pickup vs delivery</h2>
              <p className="mt-1 text-sm text-muted">Revenue split, this range.</p>
              {splitTotal === 0 ? (
                <p className="mt-4 text-sm text-muted">No paid orders in this range.</p>
              ) : (
                <>
                  <div className="mt-4 flex h-3 overflow-hidden rounded-full bg-marble">
                    <div className="bg-rose-deep" style={{ width: `${(a.pickupCents / splitTotal) * 100}%` }} />
                    <div className="ml-0.5 bg-ink" style={{ width: `${(a.deliveryCents / splitTotal) * 100}%` }} />
                  </div>
                  <div className="mt-3 flex justify-between text-sm">
                    <span>
                      <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full bg-rose-deep align-middle" />
                      Pickup {formatPrice(a.pickupCents)}
                    </span>
                    <span>
                      Delivery {formatPrice(a.deliveryCents)}
                      <span className="ml-1.5 inline-block h-2.5 w-2.5 rounded-full bg-ink align-middle" />
                    </span>
                  </div>
                </>
              )}
            </section>

            <section className="rounded-2xl border border-line bg-white p-5">
              <h2 className="font-display text-lg font-semibold">Busiest days</h2>
              <p className="mt-1 text-sm text-muted">Paid orders by fulfilment weekday.</p>
              <div className="mt-4 flex h-24 items-end justify-between gap-2">
                {a.weekdayCount.map((count, i) => (
                  <div key={i} className="flex flex-1 flex-col items-center gap-1">
                    <div className="flex w-full flex-1 items-end">
                      <div
                        className={cn("w-full rounded-t", count > 0 ? "bg-rose-deep/80" : "bg-marble")}
                        style={{ height: `${Math.max(3, (count / a.maxWeekday) * 100)}%` }}
                        title={`${WEEKDAYS[i]}: ${count}`}
                      />
                    </div>
                    <span className="text-xs text-muted">{WEEKDAYS[i][0]}</span>
                  </div>
                ))}
              </div>
            </section>
          </div>

          {/* Best sellers */}
          <section className="mt-6 rounded-2xl border border-line bg-white p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-display text-lg font-semibold">Best sellers</h2>
              <div className="flex gap-1 rounded-full border border-line p-0.5 text-xs font-semibold">
                {(["qty", "revenue", "profit"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setSellerBy(mode)}
                    aria-pressed={sellerBy === mode}
                    className={cn(
                      "rounded-full px-3 py-2 transition",
                      sellerBy === mode ? "bg-rose-deep text-white" : "text-muted hover:text-ink",
                    )}
                  >
                    {mode === "qty" ? "By quantity" : mode === "revenue" ? "By revenue" : "By profit"}
                  </button>
                ))}
              </div>
            </div>
            {sellerBy === "profit" &&
              (a.anyCost ? (
                <p className="mt-2 text-sm text-muted">
                  Estimated profit this range:{" "}
                  <span className="font-semibold text-ink">{formatPrice(a.rangeProfit)}</span>. Counts
                  only treats with a cost set.
                </p>
              ) : (
                <p className="mt-2 text-sm text-muted">
                  Add a &ldquo;cost to make&rdquo; on your products to see profit here.
                </p>
              ))}
            {a.topProducts.length === 0 ? (
              <p className="mt-4 text-sm text-muted">No paid orders in this range.</p>
            ) : (
              <ul className="mt-4 flex flex-col gap-3">
                {a.topProducts.map((product, index) => {
                  const metric =
                    sellerBy === "qty"
                      ? product.qty
                      : sellerBy === "revenue"
                        ? product.revenueCents
                        : Math.max(0, product.profitCents);
                  return (
                    <li key={product.name} className="flex items-center gap-3">
                      <span className="w-5 text-sm font-semibold text-muted">{index + 1}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="truncate font-semibold">{product.name}</span>
                          <span className="shrink-0 text-sm text-muted">
                            {sellerBy === "profit"
                              ? product.hasCost
                                ? `${formatPrice(product.profitCents)} profit`
                                : "cost not set"
                              : `${product.qty} sold · ${formatPrice(product.revenueCents)}`}
                          </span>
                        </div>
                        <div className="mt-1 h-2 overflow-hidden rounded-full bg-marble">
                          <div
                            className="h-full rounded-full bg-rose-deep/70"
                            style={{ width: `${(metric / a.maxSeller) * 100}%` }}
                          />
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
