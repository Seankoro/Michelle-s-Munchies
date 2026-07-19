"use client";

import Link from "next/link";
import { useAdmin } from "@/components/admin/AdminStore";
import { OrderStatusBadge, PaymentStatusBadge } from "@/components/admin/StatusBadge";
import { PanelLoading } from "@/components/admin/PanelLoading";
import { FirstRunChecklist } from "@/components/admin/FirstRunChecklist";
import { formatPrice } from "@/lib/catalog";
import { formatLongDate, windowRank, type AdminOrder } from "@/lib/order";
import { singaporeDateString } from "@/lib/time";
import { cn } from "@/lib/cn";

/** A calendar date shifted by whole days, kept in UTC so no timezone drift. */
function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Short "Mon 20" label for a yyyy-mm-dd date. */
function shortDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-SG", { weekday: "short", day: "numeric" });
}

export default function AdminDashboardPage() {
  const { orders, hydrated, settings } = useAdmin();

  const today = singaporeDateString();
  const tomorrow = addDaysISO(today, 1);

  // Next seven days at a glance: how full each day is against the daily cap, so
  // an over-booked day is obvious before it happens.
  const dailyCap = settings.dailyOrderCap;
  const weekAhead = Array.from({ length: 7 }, (_, i) => {
    const date = addDaysISO(today, i);
    const dayOrders = orders.filter((o) => o.status !== "cancelled" && o.scheduledDate === date);
    const count = dayOrders.length;
    // Bake load = total treats to make that day, so a day of big multi-item
    // orders reads heavier than the same number of single-cookie orders.
    const items = dayOrders.reduce(
      (sum, o) => sum + o.items.reduce((s, it) => s + it.quantity, 0),
      0,
    );
    const level =
      dailyCap && dailyCap > 0
        ? count >= dailyCap
          ? "over"
          : count / dailyCap >= 0.8
            ? "near"
            : "ok"
        : "none";
    return { date, count, items, level };
  });

  const newCount = orders.filter((o) => o.status === "received").length;
  const bakingCount = orders.filter((o) => o.status === "baking").length;
  const readyCount = orders.filter((o) =>
    ["ready", "out_for_delivery"].includes(o.status),
  ).length;
  const awaitingPayment = orders.filter((o) => o.paymentStatus === "pending").length;
  const revenue = orders
    .filter((o) => o.paymentStatus === "paid")
    .reduce((sum, o) => sum + o.totalCents, 0);

  // What needs baking, grouped by the day the customer wants it, earliest window
  // first. Cancelled orders drop out; everything else is still live work. Order
  // by the owner's own window list so "Morning" leads "Evening" (alphabetical
  // would wrongly put Afternoon and Evening ahead of Morning).
  const bakesFor = (iso: string) =>
    orders
      .filter((o) => o.status !== "cancelled" && o.scheduledDate === iso)
      .sort(
        (a, b) =>
          windowRank(settings.timeWindows, a.timeWindow) -
          windowRank(settings.timeWindows, b.timeWindow),
      );
  const todaysBakes = bakesFor(today);
  const tomorrowsBakes = bakesFor(tomorrow);

  // The sharp one: a bake is due today or tomorrow and the money is not in yet.
  const unpaidDueSoon = orders.filter(
    (o) =>
      o.status !== "cancelled" &&
      o.paymentStatus === "pending" &&
      (o.scheduledDate === today || o.scheduledDate === tomorrow),
  );

  const recent = [...orders]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 5);

  const stats = [
    { label: "New orders", value: newCount },
    { label: "In the oven", value: bakingCount },
    { label: "Ready / out", value: readyCount },
    { label: "Awaiting payment", value: awaitingPayment },
    { label: "Paid revenue", value: formatPrice(revenue) },
  ];

  return (
    <div>
      <h1 className="font-display text-3xl font-semibold">Dashboard</h1>
      <p className="mt-1 text-muted">A quick look at the bakery today.</p>

      {!hydrated ? (
        <PanelLoading />
      ) : (
        <>
          <FirstRunChecklist />

          {unpaidDueSoon.length > 0 && (
            <div className="mt-6 flex flex-wrap items-center gap-3 rounded-2xl bg-warning-soft p-4 text-warning-ink">
              <span className="text-sm font-semibold">
                ⚠️ {unpaidDueSoon.length}{" "}
                {unpaidDueSoon.length === 1 ? "order is" : "orders are"} due to bake today or
                tomorrow but still unpaid.
              </span>
              <Link
                href={`/admin/orders?order=${unpaidDueSoon[0].orderNumber}`}
                className="ml-auto shrink-0 rounded-full bg-warning-ink px-3.5 py-1.5 text-sm font-semibold text-white transition hover:brightness-110 active:scale-95"
              >
                Chase payment →
              </Link>
            </div>
          )}

          <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">
            {stats.map((stat) => (
              <div key={stat.label} className="rounded-2xl border border-line bg-white p-4 transition hover:shadow-soft">
                <p className="text-sm text-muted">{stat.label}</p>
                <p className="mt-1 font-display text-2xl font-semibold">{stat.value}</p>
              </div>
            ))}
          </div>

          <div className="mt-8 grid gap-4 lg:grid-cols-2">
            <BakeDayCard title="Bake for today" dateLabel={formatLongDate(today)} orders={todaysBakes} />
            <BakeDayCard title="Bake for tomorrow" dateLabel={formatLongDate(tomorrow)} orders={tomorrowsBakes} />
          </div>

          <section className="mt-8">
            <h2 className="font-display text-xl font-semibold">Week ahead</h2>
            <p className="mt-1 text-sm text-muted">
              {dailyCap && dailyCap > 0
                ? `Orders per day against your daily cap of ${dailyCap}.`
                : "Orders scheduled per day."}
            </p>
            <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-7">
              {weekAhead.map((day) => (
                <div
                  key={day.date}
                  className={cn(
                    "rounded-xl border p-3 text-center transition",
                    day.level === "over"
                      ? "border-danger/40 bg-danger-soft"
                      : day.level === "near"
                        ? "border-warning/40 bg-warning-soft"
                        : "border-line bg-white",
                  )}
                >
                  <p className="text-xs text-muted">{shortDay(day.date)}</p>
                  <p className="mt-1 font-display text-lg font-semibold">
                    {day.count}
                    {dailyCap && dailyCap > 0 && (
                      <span className="text-sm font-normal text-muted">/{dailyCap}</span>
                    )}
                  </p>
                  <p className="text-xs text-muted">
                    {day.items} {day.items === 1 ? "treat" : "treats"}
                  </p>
                </div>
              ))}
            </div>
          </section>

          <div className="mt-8 flex items-center justify-between">
            <h2 className="font-display text-xl font-semibold">Recent orders</h2>
            <Link href="/admin/orders" className="text-sm font-semibold text-rose-deep transition hover:text-rose">
              View all →
            </Link>
          </div>

          <div className="mt-4 overflow-x-auto rounded-2xl border border-line bg-white">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="border-b border-line bg-marble/40 text-muted">
                <tr>
                  <th className="px-4 py-3 font-semibold">Order</th>
                  <th className="px-4 py-3 font-semibold">Customer</th>
                  <th className="hidden px-4 py-3 font-semibold text-rose-deep sm:table-cell">
                    Bake for
                  </th>
                  <th className="px-4 py-3 font-semibold">Total</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="hidden px-4 py-3 font-semibold sm:table-cell">Payment</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((order) => (
                  <tr key={order.orderNumber} className="border-b border-line transition last:border-0 hover:bg-marble/30">
                    <td className="whitespace-nowrap px-4 py-3 font-semibold">
                      <Link href={`/admin/orders?order=${order.orderNumber}`} className="hover:text-rose-deep">
                        {order.orderNumber}
                      </Link>
                    </td>
                    <td className="px-4 py-3">{order.name}</td>
                    <td className="hidden whitespace-nowrap px-4 py-3 font-semibold text-rose-deep sm:table-cell">
                      {formatLongDate(order.scheduledDate)}
                    </td>
                    <td className="px-4 py-3">{formatPrice(order.totalCents)}</td>
                    <td className="px-4 py-3">
                      <OrderStatusBadge status={order.status} />
                    </td>
                    <td className="hidden px-4 py-3 sm:table-cell">
                      <PaymentStatusBadge status={order.paymentStatus} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

/** One day's worth of orders to bake, each row deep-linking into its order. */
function BakeDayCard({
  title,
  dateLabel,
  orders,
}: {
  title: string;
  dateLabel: string;
  orders: AdminOrder[];
}) {
  return (
    <section className="rounded-2xl border border-line bg-white p-5">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-display text-xl font-semibold">{title}</h2>
        <span className="text-sm text-muted">{dateLabel}</span>
      </div>
      {orders.length === 0 ? (
        <p className="mt-3 text-sm text-muted">Nothing scheduled. Enjoy the quiet.</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {orders.map((order) => (
            <li key={order.orderNumber}>
              <Link
                href={`/admin/orders?order=${order.orderNumber}`}
                className="block rounded-xl border border-line p-3 transition hover:border-rose hover:bg-blush-soft/30"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{order.name}</span>
                  <span className="shrink-0 text-sm font-semibold capitalize text-rose-deep">
                    {order.fulfillmentType}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-muted">
                  {order.timeWindow || "Any time"} · {order.orderNumber}
                </p>
                <p className="mt-1 text-sm">
                  {order.items.map((item) => `${item.quantity}× ${item.name}`).join(", ")}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <OrderStatusBadge status={order.status} />
                  <PaymentStatusBadge status={order.paymentStatus} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
