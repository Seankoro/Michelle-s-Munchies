"use client";

import { useMemo, useRef, useState } from "react";
import { useAdmin } from "@/components/admin/AdminStore";
import { OrderStatusBadge, PaymentStatusBadge } from "@/components/admin/StatusBadge";
import { formatPrice } from "@/lib/catalog";
import {
  formatLongDate,
  ORDER_STATUSES,
  orderStatusLabels,
  paymentStatusLabels,
  type AdminOrder,
  type OrderStatus,
  type PaymentStatus,
} from "@/lib/order";
import { cn } from "@/lib/cn";
import { useDialog } from "@/lib/useDialog";

// The status path Michelle walks an order through, by fulfillment type.
function statusFlow(order: AdminOrder): OrderStatus[] {
  const base: OrderStatus[] = ["received", "confirmed", "baking", "ready"];
  return order.fulfillmentType === "delivery"
    ? [...base, "out_for_delivery", "completed"]
    : [...base, "completed"];
}

function nextStatus(order: AdminOrder): OrderStatus | null {
  const flow = statusFlow(order);
  const index = flow.indexOf(order.status);
  if (index === -1 || index === flow.length - 1) return null;
  return flow[index + 1];
}

export default function AdminOrdersPage() {
  const { orders, updateOrderStatus, updatePaymentStatus, cancelOrder } = useAdmin();
  const [filter, setFilter] = useState<OrderStatus | "all">("all");
  const [selected, setSelected] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const list = filter === "all" ? orders : orders.filter((o) => o.status === filter);
    return [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [orders, filter]);

  const selectedOrder = orders.find((o) => o.orderNumber === selected) ?? null;

  return (
    <div>
      <h1 className="font-display text-3xl font-semibold">Orders</h1>
      <p className="mt-1 text-muted">Track and update every order.</p>

      <div className="mt-6 flex flex-wrap gap-2">
        {(["all", ...ORDER_STATUSES] as const).map((status) => (
          <button
            key={status}
            type="button"
            onClick={() => setFilter(status)}
            aria-pressed={filter === status}
            className={cn(
              "rounded-full border px-3 py-1.5 text-sm font-semibold transition active:scale-95",
              filter === status
                ? "border-rose-deep bg-blush-soft text-rose-deep"
                : "border-line bg-white text-ink hover:border-rose",
            )}
          >
            {status === "all" ? "All" : orderStatusLabels[status]}
          </button>
        ))}
      </div>

      <div className="mt-4 overflow-x-auto rounded-2xl border border-line bg-white">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="border-b border-line bg-marble/40 text-muted">
            <tr>
              <th className="px-4 py-3 font-semibold">Order</th>
              <th className="px-4 py-3 font-semibold">Customer</th>
              <th className="px-4 py-3 font-semibold">Fulfilment</th>
              <th className="px-4 py-3 font-semibold">For</th>
              <th className="px-4 py-3 font-semibold">Total</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 font-semibold">Payment</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((order) => (
              <tr
                key={order.orderNumber}
                onClick={() => setSelected(order.orderNumber)}
                className="cursor-pointer border-b border-line transition last:border-0 hover:bg-blush-soft/40"
              >
                <td className="px-4 py-3 font-semibold">
                  {order.isGift && <span title="Gift order">🎁 </span>}
                  {order.orderNumber}
                </td>
                <td className="px-4 py-3">{order.name}</td>
                <td className="px-4 py-3 capitalize text-muted">{order.fulfillmentType}</td>
                <td className="px-4 py-3 text-muted">{formatLongDate(order.scheduledDate)}</td>
                <td className="px-4 py-3">{formatPrice(order.totalCents)}</td>
                <td className="px-4 py-3">
                  <OrderStatusBadge status={order.status} />
                </td>
                <td className="px-4 py-3">
                  <PaymentStatusBadge status={order.paymentStatus} />
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-muted">
                  No orders with this status.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {selectedOrder && (
        <OrderDetailModal
          order={selectedOrder}
          onClose={() => setSelected(null)}
          onStatusChange={(status) => updateOrderStatus(selectedOrder.orderNumber, status)}
          onPaymentChange={(status) => updatePaymentStatus(selectedOrder.orderNumber, status)}
          onCancel={() => cancelOrder(selectedOrder.orderNumber)}
        />
      )}
    </div>
  );
}

function OrderDetailModal({
  order,
  onClose,
  onStatusChange,
  onPaymentChange,
  onCancel,
}: {
  order: AdminOrder;
  onClose: () => void;
  onStatusChange: (status: OrderStatus) => void;
  onPaymentChange: (status: PaymentStatus) => void;
  onCancel: () => Promise<{ ok: boolean; refunded?: boolean; error?: string }>;
}) {
  const advance = nextStatus(order);
  const alreadyCancelled = order.status === "cancelled";
  const panelRef = useRef<HTMLDivElement>(null);
  useDialog(true, onClose, panelRef);

  async function handleCancel() {
    const paid = order.paymentStatus === "paid";
    if (
      !confirm(
        paid
          ? "Cancel this order and refund the customer via Stripe?"
          : "Cancel this order?",
      )
    )
      return;
    const result = await onCancel();
    if (!result.ok) alert(result.error ?? "Could not cancel the order.");
    else if (result.refunded) alert("Order cancelled and refunded.");
    else alert("Order cancelled.");
  }
  const selectClass =
    "rounded-xl border border-line bg-white px-3 py-2 text-sm outline-none focus:border-rose";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Order ${order.orderNumber}`}
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 sm:items-center sm:p-4"
    >
      <div
        ref={panelRef}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full max-w-lg animate-[fade-up_0.2s_ease-out] overflow-y-auto rounded-t-2xl bg-white p-6 shadow-soft sm:rounded-2xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-xl font-semibold">{order.orderNumber}</h2>
            <p className="text-sm text-muted">
              {order.name} · {formatLongDate(order.scheduledDate)} · {order.timeWindow}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-full p-2 text-muted transition hover:bg-blush-soft active:scale-90"
          >
            ✕
          </button>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <OrderStatusBadge status={order.status} />
          <PaymentStatusBadge status={order.paymentStatus} />
          <span className="rounded-full bg-marble px-2.5 py-0.5 text-xs font-semibold capitalize text-muted">
            {order.fulfillmentType}
          </span>
        </div>

        {/* Items */}
        <ul className="mt-4 flex flex-col gap-2 text-sm">
          {order.items.map((item) => (
            <li key={item.key} className="flex justify-between gap-3">
              <span>
                <span className="font-semibold">{item.quantity}×</span> {item.name}
                {item.selectedOptions.length > 0 && (
                  <span className="text-muted">
                    {" "}
                    ({item.selectedOptions.map((o) => o.valueLabel).join(", ")})
                  </span>
                )}
              </span>
              <span className="font-semibold">
                {formatPrice(item.unitPriceCents * item.quantity)}
              </span>
            </li>
          ))}
        </ul>
        <hr className="my-3 border-line" />
        <div className="flex justify-between text-sm font-semibold">
          <span>Total ({order.deliveryFeeCents > 0 ? "incl. delivery" : "pickup"})</span>
          <span>{formatPrice(order.totalCents)}</span>
        </div>

        {/* Contact / address / notes */}
        <dl className="mt-4 grid gap-1 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-muted">Contact</dt>
            <dd className="text-right">
              {order.email} · {order.phone}
            </dd>
          </div>
          {order.address && (
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Address</dt>
              <dd className="text-right">
                {order.address.line1}
                {order.address.unit ? `, ${order.address.unit}` : ""}, S{order.address.postalCode}
              </dd>
            </div>
          )}
          {order.notes && (
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Notes</dt>
              <dd className="text-right">{order.notes}</dd>
            </div>
          )}
        </dl>

        {/* Gift */}
        {order.isGift && (
          <div className="mt-4 rounded-2xl bg-blush-soft/60 p-4 text-sm text-rose-deep">
            <p className="font-semibold">🎁 Gift order. Include a card, no receipt in the package.</p>
            <p className="mt-1">
              For: <span className="font-semibold">{order.recipientName || "Not set"}</span>
              {order.recipientPhone && <> · {order.recipientPhone}</>}
            </p>
            {order.giftMessage && (
              <p className="mt-2 italic">&ldquo;{order.giftMessage}&rdquo;</p>
            )}
          </div>
        )}

        {/* Controls */}
        <div className="mt-5 rounded-2xl bg-marble/40 p-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Order status
              <select
                className={selectClass}
                value={order.status}
                onChange={(e) => onStatusChange(e.target.value as OrderStatus)}
              >
                {ORDER_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {orderStatusLabels[status]}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-sm font-semibold">
              Payment
              <select
                className={selectClass}
                value={order.paymentStatus}
                onChange={(e) => onPaymentChange(e.target.value as PaymentStatus)}
              >
                {(Object.keys(paymentStatusLabels) as PaymentStatus[]).map((status) => (
                  <option key={status} value={status}>
                    {paymentStatusLabels[status]}
                  </option>
                ))}
              </select>
            </label>

            {advance && (
              <button
                type="button"
                onClick={() => onStatusChange(advance)}
                className="rounded-full bg-rose-deep px-4 py-2 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:brightness-110 active:scale-95"
              >
                Advance → {orderStatusLabels[advance]}
              </button>
            )}
          </div>
          <p className="mt-3 text-xs text-muted">
            ✉️ Changing the status emails the customer automatically.
          </p>

          {!alreadyCancelled && (
            <div className="mt-4 border-t border-line pt-4">
              <button
                type="button"
                onClick={handleCancel}
                className="rounded-full border border-rose-deep px-4 py-2 text-sm font-semibold text-rose-deep transition hover:bg-blush-soft active:scale-95"
              >
                Cancel order{order.paymentStatus === "paid" ? " & refund" : ""}
              </button>
              <p className="mt-2 text-xs text-muted">
                {order.paymentStatus === "paid"
                  ? "Refunds the payment via Stripe and puts any tracked stock back."
                  : "Marks the order cancelled."}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
