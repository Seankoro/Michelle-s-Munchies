"use client";

import { useEffect, useMemo, useState } from "react";
import { useAdmin } from "@/components/admin/AdminStore";
import { OrderStatusBadge, PaymentStatusBadge } from "@/components/admin/StatusBadge";
import { NewOrderModal } from "@/components/admin/NewOrderModal";
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
import {
  customerEmailUrl,
  customerWhatsAppUrl,
  mapsSearchUrl,
  paymentReminderMessage,
  telUrl,
} from "@/lib/customer-contact";
import { cn } from "@/lib/cn";
import { AdminModal } from "@/components/admin/AdminModal";
import { TableStateRow } from "@/components/admin/TableStateRow";

// The status path Michelle walks an order through, by fulfillment type.
/** Column count of the orders table, so the state-row colSpan is defined once. */
const TABLE_COLUMNS = 8;

/** When the customer placed the order, as a short Singapore-time date. */
function orderedOn(iso: string): string {
  return new Date(iso).toLocaleDateString("en-SG", {
    timeZone: "Asia/Singapore",
    day: "numeric",
    month: "short",
  });
}

/** Full placed-at moment for the order detail, date and time in Singapore. */
function orderedOnFull(iso: string): string {
  return new Date(iso).toLocaleString("en-SG", {
    timeZone: "Asia/Singapore",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

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
  const {
    orders,
    hydrated,
    settings,
    updateOrderStatus,
    updatePaymentStatus,
    updateOwnerNote,
    rescheduleOrder,
    recordDeposit,
    cancelOrder,
  } = useAdmin();
  const [filter, setFilter] = useState<OrderStatus | "all">("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [showNewOrder, setShowNewOrder] = useState(false);

  // Open a specific order straight from a dashboard deep-link (/admin/orders?order=…).
  useEffect(() => {
    const target = new URLSearchParams(window.location.search).get("order");
    if (target) setSelected(target);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const byStatus = filter === "all" ? orders : orders.filter((o) => o.status === filter);
    const list = q
      ? byStatus.filter((o) =>
          [o.orderNumber, o.name, o.phone, o.email, o.recipientName ?? ""].some((field) =>
            field.toLowerCase().includes(q),
          ),
        )
      : byStatus;
    return [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [orders, filter, query]);

  const selectedOrder = orders.find((o) => o.orderNumber === selected) ?? null;

  // Non-cancelled order count per date, so the reschedule picker can warn when a
  // day is already at capacity.
  const dayCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const o of orders) {
      if (o.status !== "cancelled") counts[o.scheduledDate] = (counts[o.scheduledDate] ?? 0) + 1;
    }
    return counts;
  }, [orders]);

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold">Orders</h1>
          <p className="mt-1 text-muted">Track and update every order.</p>
        </div>
        <button
          type="button"
          onClick={() => setShowNewOrder(true)}
          className="shrink-0 rounded-full bg-rose-deep px-5 py-2.5 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:brightness-110 active:scale-95"
        >
          + New order
        </button>
      </div>

      <label className="relative mt-6 block sm:max-w-xs">
        <span className="sr-only">Search orders</span>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search order #, name, phone, email…"
          className="w-full rounded-full border border-line bg-white px-4 py-2 text-base transition focus:border-rose sm:text-sm"
        />
      </label>

      <div className="mt-4 flex flex-wrap gap-2">
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
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="border-b border-line bg-marble/40 text-muted">
            <tr>
              <th className="px-4 py-3 font-semibold">Order</th>
              <th className="px-4 py-3 font-semibold">Customer</th>
              <th className="px-4 py-3 font-semibold">Fulfilment</th>
              <th className="px-4 py-3 font-semibold">Ordered</th>
              <th className="px-4 py-3 font-semibold text-rose-deep">Bake for</th>
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
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelected(order.orderNumber);
                  }
                }}
                tabIndex={0}
                role="button"
                aria-label={`Open order ${order.orderNumber} for ${order.name}`}
                className="cursor-pointer border-b border-line transition last:border-0 hover:bg-blush-soft/40 focus:bg-blush-soft/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose"
              >
                <td className="whitespace-nowrap px-4 py-3 font-semibold">
                  {order.isGift && <span title="Gift order">🎁 </span>}
                  {order.orderNumber}
                </td>
                <td className="px-4 py-3">{order.name}</td>
                <td className="px-4 py-3 capitalize text-muted">{order.fulfillmentType}</td>
                <td className="whitespace-nowrap px-4 py-3 text-muted">
                  {orderedOn(order.createdAt)}
                </td>
                <td className="whitespace-nowrap px-4 py-3 font-semibold text-rose-deep">
                  {formatLongDate(order.scheduledDate)}
                </td>
                <td className="px-4 py-3">{formatPrice(order.totalCents)}</td>
                <td className="px-4 py-3">
                  <OrderStatusBadge status={order.status} />
                </td>
                <td className="px-4 py-3">
                  <PaymentStatusBadge status={order.paymentStatus} />
                </td>
              </tr>
            ))}
            {!hydrated && (
              <TableStateRow colSpan={TABLE_COLUMNS}>Loading orders…</TableStateRow>
            )}
            {hydrated && filtered.length === 0 && (
              <TableStateRow colSpan={TABLE_COLUMNS}>
                {query.trim()
                  ? "No orders match that search."
                  : filter === "all"
                    ? "No orders yet. New ones appear here the moment they come in."
                    : "No orders with this status."}
              </TableStateRow>
            )}
          </tbody>
        </table>
      </div>

      {selectedOrder && (
        <OrderDetailModal
          key={selectedOrder.orderNumber}
          order={selectedOrder}
          onClose={() => {
            setSelected(null);
            if (window.location.search.includes("order=")) {
              window.history.replaceState(null, "", "/admin/orders");
            }
          }}
          onStatusChange={(status) => updateOrderStatus(selectedOrder.orderNumber, status)}
          onPaymentChange={(status) => updatePaymentStatus(selectedOrder.orderNumber, status)}
          onOwnerNoteSave={(note) => updateOwnerNote(selectedOrder.orderNumber, note)}
          onReschedule={(date, window) =>
            rescheduleOrder(selectedOrder.orderNumber, date, window)
          }
          timeWindows={settings.timeWindows}
          blackoutDates={settings.blackoutDates}
          dailyOrderCap={settings.dailyOrderCap}
          dayCounts={dayCounts}
          onRecordDeposit={(cents) => recordDeposit(selectedOrder.orderNumber, cents)}
          onCancel={() => cancelOrder(selectedOrder.orderNumber)}
        />
      )}

      {showNewOrder && <NewOrderModal onClose={() => setShowNewOrder(false)} />}
    </div>
  );
}

function OrderDetailModal({
  order,
  onClose,
  onStatusChange,
  onPaymentChange,
  onOwnerNoteSave,
  onReschedule,
  timeWindows,
  blackoutDates,
  dailyOrderCap,
  dayCounts,
  onRecordDeposit,
  onCancel,
}: {
  order: AdminOrder;
  onClose: () => void;
  onStatusChange: (status: OrderStatus) => void;
  onPaymentChange: (status: PaymentStatus) => void;
  onOwnerNoteSave: (note: string) => void;
  onReschedule: (date: string, timeWindow: string) => void;
  timeWindows: string[];
  blackoutDates: string[];
  dailyOrderCap: number | null;
  dayCounts: Record<string, number>;
  onRecordDeposit: (cents: number) => void;
  onCancel: () => Promise<{ ok: boolean; refunded?: boolean; error?: string }>;
}) {
  const advance = nextStatus(order);
  const alreadyCancelled = order.status === "cancelled";
  const [reDate, setReDate] = useState(order.scheduledDate);
  const [reWindow, setReWindow] = useState(order.timeWindow);
  const [depositInput, setDepositInput] = useState(
    order.depositCents != null && order.depositCents > 0
      ? (order.depositCents / 100).toFixed(2)
      : "",
  );
  const windowOptions = timeWindows.includes(order.timeWindow)
    ? timeWindows
    : [order.timeWindow, ...timeWindows].filter(Boolean);
  // Safe payment transitions only. "Refunded" is reached through Cancel & refund
  // (which actually refunds and restocks), and a paid order is never reverted
  // here, since its points and stock side effects can't be undone by relabelling.
  const paymentOptions: PaymentStatus[] =
    order.paymentStatus === "pending"
      ? ["pending", "paid", "failed"]
      : order.paymentStatus === "failed"
        ? ["failed", "pending", "paid"]
        : [order.paymentStatus];
  // Warn (never block) if the new slot is a blackout day or already at capacity.
  const reWarning =
    reDate && reDate !== order.scheduledDate
      ? blackoutDates.includes(reDate)
        ? "that date is a blackout day"
        : dailyOrderCap && dailyOrderCap > 0 && (dayCounts[reDate] ?? 0) >= dailyOrderCap
          ? `that day is at your cap of ${dailyOrderCap} orders`
          : null
      : null;
  const waUrl = customerWhatsAppUrl(order.phone);
  const payNudgeUrl = customerWhatsAppUrl(order.phone, paymentReminderMessage(order));

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
    "rounded-xl border border-line bg-white px-3 py-2 text-base focus:border-rose sm:text-sm";

  return (
    <AdminModal
      onClose={onClose}
      ariaLabel={`Order ${order.orderNumber}`}
      panelClassName="flex max-h-[90dvh] w-full max-w-lg animate-[fade-up_0.2s_ease-out] flex-col rounded-t-2xl bg-white shadow-soft sm:rounded-2xl"
    >
        {/* Fixed header so the close button stays reachable while the details scroll. */}
        <div className="flex items-start justify-between gap-4 rounded-t-2xl border-b border-line bg-white px-6 py-4">
          <div>
            <h2 className="font-display text-xl font-semibold">{order.orderNumber}</h2>
            <p className="text-sm text-muted">{order.name}</p>
            <p className="mt-1 text-sm text-muted">Ordered {orderedOnFull(order.createdAt)}</p>
            <p className="text-sm font-semibold text-rose-deep">
              Bake for {formatLongDate(order.scheduledDate)}
              {order.timeWindow ? ` · ${order.timeWindow}` : ""}
            </p>
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

        <div className="overflow-y-auto px-6 pb-6 pt-4">
        <div className="flex flex-wrap items-center gap-2">
          <OrderStatusBadge status={order.status} />
          <PaymentStatusBadge status={order.paymentStatus} />
          <span className="rounded-full bg-marble px-2.5 py-0.5 text-xs font-semibold capitalize text-muted">
            {order.fulfillmentType}
          </span>
        </div>

        {/* Items */}
        <ul className="mt-4 flex flex-col gap-2 text-sm">
          {order.items.map((item) => (
            <li key={item.key} className="flex flex-col gap-1">
              <div className="flex justify-between gap-3">
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
              </div>
              {item.personalisation && (item.personalisation.message || item.personalisation.photoUrl) && (
                <div className="ml-5 rounded-lg bg-blush-soft/50 px-3 py-2 text-xs text-rose-deep">
                  {item.personalisation.message && (
                    <p>
                      ✍️ &ldquo;{item.personalisation.message}&rdquo;
                    </p>
                  )}
                  {item.personalisation.photoUrl && (
                    <a
                      href={item.personalisation.photoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-semibold underline"
                    >
                      📎 View reference photo
                    </a>
                  )}
                </div>
              )}
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
                <a
                  href={mapsSearchUrl(
                    `${order.address.line1}${order.address.unit ? `, ${order.address.unit}` : ""}, Singapore ${order.address.postalCode}`,
                  )}
                  target="_blank"
                  rel="noreferrer"
                  className="font-semibold text-rose-deep underline decoration-rose/40 underline-offset-2 transition hover:text-rose"
                >
                  {order.address.line1}
                  {order.address.unit ? `, ${order.address.unit}` : ""}, S{order.address.postalCode}
                </a>
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

        {/* One-tap ways to reach the customer */}
        <div className="mt-3 flex flex-wrap gap-2">
          {waUrl && (
            <a
              href={waUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white px-3.5 py-2 text-sm font-semibold text-ink transition hover:border-rose active:scale-95"
            >
              💬 WhatsApp
            </a>
          )}
          <a
            href={telUrl(order.phone)}
            className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white px-3.5 py-2 text-sm font-semibold text-ink transition hover:border-rose active:scale-95"
          >
            📞 Call
          </a>
          <a
            href={customerEmailUrl(order)}
            className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white px-3.5 py-2 text-sm font-semibold text-ink transition hover:border-rose active:scale-95"
          >
            ✉️ Email
          </a>
        </div>

        {/* Private note to self */}
        <div className="mt-4">
          <label htmlFor={`note-${order.orderNumber}`} className="text-sm font-semibold">
            Note to self
          </label>
          <textarea
            id={`note-${order.orderNumber}`}
            defaultValue={order.ownerNote ?? ""}
            onBlur={(e) => onOwnerNoteSave(e.target.value)}
            rows={2}
            placeholder="Private reminder only you see. e.g. double-bag, nut allergy"
            className="mt-1 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm transition focus:border-rose"
          />
          <p className="mt-1 text-xs text-muted">
            Saved when you click away. The customer never sees this.
          </p>
        </div>

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
                {/* Cancelling is only offered through the Cancel button below,
                    which also refunds and restocks. The status list drops it so
                    it can't be set here as a second path that skips both. */}
                {ORDER_STATUSES.filter(
                  (status) => status !== "cancelled" || order.status === "cancelled",
                ).map((status) => (
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
                disabled={paymentOptions.length === 1}
                onChange={(e) => onPaymentChange(e.target.value as PaymentStatus)}
              >
                {paymentOptions.map((status) => (
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

          {/* Reschedule, for when a customer asks over the phone or WhatsApp. */}
          <div className="mt-4 border-t border-line pt-4">
            <p className="text-sm font-semibold">Reschedule</p>
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <input
                type="date"
                value={reDate}
                onChange={(e) => setReDate(e.target.value)}
                aria-label="New bake date"
                className={selectClass}
              />
              <select
                value={reWindow}
                onChange={(e) => setReWindow(e.target.value)}
                aria-label="New time window"
                className={selectClass}
              >
                {windowOptions.map((window) => (
                  <option key={window} value={window}>
                    {window}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => onReschedule(reDate, reWindow)}
                disabled={reDate === order.scheduledDate && reWindow === order.timeWindow}
                className="rounded-full border border-line px-4 py-2 text-sm font-semibold transition hover:border-rose active:scale-95 disabled:opacity-50"
              >
                Move
              </button>
            </div>
            {reWarning && (
              <p role="status" className="mt-2 text-xs font-semibold text-warning-ink">
                Heads up: {reWarning}. You can still move it.
              </p>
            )}
          </div>

          {order.paymentStatus === "pending" && (
            <div className="mt-3 rounded-xl bg-warning-soft p-3">
              <p className="text-sm font-semibold text-warning-ink">
                {order.depositCents != null && order.depositCents > 0
                  ? "Deposit paid, balance due"
                  : "Awaiting payment"}
              </p>
              {order.depositCents != null && order.depositCents > 0 && (
                <p className="mt-0.5 text-sm text-warning-ink">
                  {formatPrice(order.depositCents)} deposit ·{" "}
                  <span className="font-semibold">
                    {formatPrice(order.totalCents - order.depositCents)} balance
                  </span>
                </p>
              )}
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => onPaymentChange("paid")}
                  className="rounded-full bg-success px-4 py-1.5 text-sm font-semibold text-white transition hover:brightness-110 active:scale-95"
                >
                  ✓ Mark {order.depositCents ? "balance " : ""}paid
                </button>
                {payNudgeUrl && (
                  <a
                    href={payNudgeUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-full border border-warning-ink/40 bg-white px-4 py-1.5 text-sm font-semibold text-warning-ink transition hover:border-warning-ink active:scale-95"
                  >
                    💬 Send PayNow reminder
                  </a>
                )}
              </div>
              {/* Deposit for custom-cake orders, secure the slot with part-payment. */}
              <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-warning-ink/20 pt-2">
                <span className="text-xs font-semibold text-warning-ink">Deposit S$</span>
                <input
                  inputMode="decimal"
                  value={depositInput}
                  onChange={(e) => setDepositInput(e.target.value)}
                  placeholder="0.00"
                  className="w-20 rounded-lg border border-warning-ink/30 bg-white px-2 py-1 text-sm"
                />
                <button
                  type="button"
                  onClick={() =>
                    onRecordDeposit(Math.max(0, Math.round(parseFloat(depositInput || "0") * 100)))
                  }
                  className="rounded-full border border-warning-ink/40 bg-white px-3 py-1 text-xs font-semibold text-warning-ink transition hover:border-warning-ink active:scale-95"
                >
                  Record
                </button>
                {order.depositCents != null && order.depositCents > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setDepositInput("");
                      onRecordDeposit(0);
                    }}
                    className="text-xs font-semibold text-warning-ink underline"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
          )}

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
    </AdminModal>
  );
}
