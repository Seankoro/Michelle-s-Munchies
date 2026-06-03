"use client";

import Link from "next/link";
import { useAdmin } from "@/components/admin/AdminStore";
import { OrderStatusBadge, PaymentStatusBadge } from "@/components/admin/StatusBadge";
import { formatPrice } from "@/lib/catalog";
import { formatLongDate } from "@/lib/order";

export default function AdminDashboardPage() {
  const { orders, hydrated } = useAdmin();

  const newCount = orders.filter((o) => o.status === "received").length;
  const bakingCount = orders.filter((o) => o.status === "baking").length;
  const readyCount = orders.filter((o) =>
    ["ready", "out_for_delivery"].includes(o.status),
  ).length;
  const awaitingPayment = orders.filter((o) => o.paymentStatus === "pending").length;
  const revenue = orders
    .filter((o) => o.paymentStatus === "paid")
    .reduce((sum, o) => sum + o.totalCents, 0);

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
        null
      ) : (
        <>
          <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-5">
            {stats.map((stat) => (
              <div key={stat.label} className="rounded-2xl border border-line bg-white p-4 transition hover:shadow-soft">
                <p className="text-sm text-muted">{stat.label}</p>
                <p className="mt-1 font-display text-2xl font-semibold">{stat.value}</p>
              </div>
            ))}
          </div>

          <div className="mt-8 flex items-center justify-between">
            <h2 className="font-display text-xl font-semibold">Recent orders</h2>
            <Link href="/admin/orders" className="text-sm font-semibold text-rose transition hover:text-rose-deep">
              View all →
            </Link>
          </div>

          <div className="mt-4 overflow-x-auto rounded-2xl border border-line bg-white">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="border-b border-line bg-marble/40 text-muted">
                <tr>
                  <th className="px-4 py-3 font-semibold">Order</th>
                  <th className="px-4 py-3 font-semibold">Customer</th>
                  <th className="hidden px-4 py-3 font-semibold sm:table-cell">For</th>
                  <th className="px-4 py-3 font-semibold">Total</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="hidden px-4 py-3 font-semibold sm:table-cell">Payment</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((order) => (
                  <tr key={order.orderNumber} className="border-b border-line transition last:border-0 hover:bg-marble/30">
                    <td className="px-4 py-3 font-semibold">
                      <Link href="/admin/orders" className="hover:text-rose-deep">
                        {order.orderNumber}
                      </Link>
                    </td>
                    <td className="px-4 py-3">{order.name}</td>
                    <td className="hidden px-4 py-3 text-muted sm:table-cell">
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
