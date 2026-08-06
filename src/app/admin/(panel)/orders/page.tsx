"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAdmin } from "@/components/admin/AdminStore";
import { OrderStatusBadge, PaymentStatusBadge } from "@/components/admin/StatusBadge";
import { NewOrderModal } from "@/components/admin/NewOrderModal";
import { formatPrice } from "@/lib/catalog";
import {
  formatLongDate,
  ORDER_STATUSES,
  orderStatusLabels,
  paymentStatusLabels,
  statusRequiresPayment,
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
import { singaporeDateString } from "@/lib/time";
import { cn } from "@/lib/cn";
import type { RecordRefundResult, RemoveItemsResult } from "@/lib/admin-actions";
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

/**
 * Statuses where a date that has gone by is still worth moving. Once an order
 * is ready it is baked and boxed, and out for delivery it may already be with
 * the customer, so asking for a new date there is asking her to fix something
 * that is already done.
 */
const RESCHEDULABLE_STATUSES: OrderStatus[] = ["received", "confirmed", "baking"];

/**
 * Paid, still to bake, and the date the customer picked at checkout has already
 * gone by. scheduledDate never moves when payment lands late, so without a
 * prompt these orders sit stranded in the past where nobody looks.
 */
function bakeDateHasPassed(order: AdminOrder, today: string): boolean {
  return (
    order.paymentStatus === "paid" &&
    RESCHEDULABLE_STATUSES.includes(order.status) &&
    order.scheduledDate < today
  );
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
    setDeliveryAddress,
    cancelOrder,
    recordRefund,
    removeOrderItems,
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

  // Today in Singapore, for spotting orders whose bake date has already gone by.
  const today = singaporeDateString();

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
    return [...list].sort((a, b) => {
      // A paid order whose bake date has passed is the one thing that needs
      // acting on today, so it goes above the usual newest-first order rather
      // than staying buried where a late payment left it.
      const aLate = bakeDateHasPassed(a, today);
      const bLate = bakeDateHasPassed(b, today);
      if (aLate !== bLate) return aLate ? -1 : 1;
      return b.createdAt.localeCompare(a.createdAt);
    });
  }, [orders, filter, query, today]);

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
                  {bakeDateHasPassed(order, today) && (
                    <span className="mt-0.5 block text-xs font-semibold text-warning-ink">
                      Paid, bake date has passed
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {formatPrice(order.totalCents)}
                  {order.refundedCents != null && order.refundedCents > 0 && (
                    <span className="mt-0.5 block whitespace-nowrap text-xs text-muted">
                      -{formatPrice(order.refundedCents)} refunded
                    </span>
                  )}
                </td>
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
          onSetAddress={(address, window) =>
            setDeliveryAddress(selectedOrder.orderNumber, address, window)
          }
          timeWindows={settings.timeWindows}
          blackoutDates={settings.blackoutDates}
          dailyOrderCap={settings.dailyOrderCap}
          dayCounts={dayCounts}
          today={today}
          onCancel={() =>
            cancelOrder(selectedOrder.orderNumber)
          }
          onRecordRefund={(cents, reason, via) =>
            recordRefund(selectedOrder.orderNumber, cents, reason, via)
          }
          onRemoveItems={(itemIds) => removeOrderItems(selectedOrder.orderNumber, itemIds)}
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
  onSetAddress,
  timeWindows,
  blackoutDates,
  dailyOrderCap,
  dayCounts,
  today,
  onCancel,
  onRecordRefund,
  onRemoveItems,
}: {
  order: AdminOrder;
  onClose: () => void;
  onStatusChange: (status: OrderStatus) => void;
  onPaymentChange: (status: PaymentStatus) => void;
  onOwnerNoteSave: (note: string) => void;
  onReschedule: (date: string, timeWindow: string) => void;
  onSetAddress: (
    address: { line1: string; unit: string; postalCode: string },
    timeWindow: string,
  ) => void;
  timeWindows: string[];
  blackoutDates: string[];
  dailyOrderCap: number | null;
  dayCounts: Record<string, number>;
  today: string;
  onCancel: () => Promise<{
    ok: boolean;
    refunded?: boolean;
    /** Paid outside Stripe, so nothing was reversed and the money goes back by hand. */
    manualRefundDue?: boolean;
    amountCents?: number;
    error?: string;
  }>;
  onRecordRefund: (
    amountCents: number,
    reason: string,
    via: "manual" | "stripe",
  ) => Promise<RecordRefundResult>;
  onRemoveItems: (itemIds: string[]) => Promise<RemoveItemsResult>;
}) {
  const advance = nextStatus(order);
  const alreadyCancelled = order.status === "cancelled";
  // Only offer statuses that make sense for this order's fulfilment type (so a
  // pickup order is never offered "Out for delivery"), plus the order's current
  // status in case it's already in a state outside that flow (e.g. a stale
  // delivery-only status saved before this filter existed). A cancelled order is
  // offered nothing else: putting it back into the flow would email the customer
  // a confirmation after they were told it was cancelled, and leave an order
  // that holds no stock and, once refunded, can't be marked paid again.
  const flow = statusFlow(order);
  const statusOptions: OrderStatus[] = alreadyCancelled
    ? ["cancelled"]
    : flow.includes(order.status)
      ? flow
      : [order.status, ...flow];
  // A delivery order with nowhere to go. The gift recipient's link answers the
  // address question once and then closes, so one that was never opened leaves
  // this blank and Michelle is the only one who can fill it in now.
  const isDelivery = order.fulfillmentType === "delivery";
  const missingAddress = isDelivery && !order.address && !alreadyCancelled;
  const [reDate, setReDate] = useState(order.scheduledDate);
  const [reWindow, setReWindow] = useState(order.timeWindow);
  const [addrLine1, setAddrLine1] = useState(order.address?.line1 ?? "");
  const [addrUnit, setAddrUnit] = useState(order.address?.unit ?? "");
  const [addrPostal, setAddrPostal] = useState(order.address?.postalCode ?? "");
  // Blank, not the first window, when the order carries none. Preselecting
  // Morning meant saving an address also recorded a delivery time nobody chose,
  // and the box would then go out against it.
  const [addrWindow, setAddrWindow] = useState(order.timeWindow ?? "");
  // Already open when there is nothing to deliver to, so the one thing worth
  // doing on the order is in front of her rather than behind another tap.
  const [showAddress, setShowAddress] = useState(missingAddress);
  // Money returned on an order that still stands, e.g. one squashed tin out of
  // six. Kept separate from cancelling, which un-bakes the whole order.
  const [refundAmount, setRefundAmount] = useState("");
  const [refundReason, setRefundReason] = useState("");
  const [refundVia, setRefundVia] = useState<"manual" | "stripe">("manual");
  const [refundBusy, setRefundBusy] = useState(false);
  const [showRefund, setShowRefund] = useState(false);
  const [removeIds, setRemoveIds] = useState<string[]>([]);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [showRemove, setShowRemove] = useState(false);
  // So the stranded-order banner can put the cursor straight in the date field
  // instead of leaving Michelle to hunt down the reschedule block.
  const reDateRef = useRef<HTMLInputElement>(null);
  // So the no-address banner can put the cursor straight in the address field.
  const addrLine1Ref = useRef<HTMLInputElement>(null);
  // Removing items offers the matching refund next, so the amount field needs to
  // take focus with the figure already filled in.
  const refundAmountRef = useRef<HTMLInputElement>(null);
  const refundedCents = order.refundedCents ?? 0;
  // What the shop actually kept, which is the figure Insights now reports.
  const netKeptCents = order.totalCents - refundedCents;
  const bakeDatePassed = bakeDateHasPassed(order, today);
  const windowOptions = timeWindows.includes(order.timeWindow)
    ? timeWindows
    : [order.timeWindow, ...timeWindows].filter(Boolean);
  // Safe payment transitions only. "Refunded" is reached through the cancel
  // button below, which actually refunds and restocks.
  //
  // A hand-marked payment CAN be taken back, because marking paid is one tap on
  // a phone against a list of similar names and the money never arrived. The
  // server puts the stock and the points back when it happens. It mirrors the
  // server's own two rules exactly rather than inventing a stricter one: not
  // once the order is being baked, and not when Stripe is really holding the
  // money, which has to go back through a refund instead.
  const canUndoPaid =
    order.paymentStatus === "paid" &&
    !alreadyCancelled &&
    !statusRequiresPayment(order.status) &&
    !order.paidViaStripe;
  const paymentTransitions: PaymentStatus[] =
    order.paymentStatus === "pending"
      ? ["pending", "paid", "failed"]
      : order.paymentStatus === "failed"
        ? ["failed", "pending", "paid"]
        : canUndoPaid
          ? ["paid", "pending"]
          : [order.paymentStatus];
  // A cancelled order can never be marked paid. The server rejects it outright,
  // and taking money for an order that holds no stock and gets no bake is a trap.
  // Its own current status still has to stay in the list, or a cancelled order
  // that was already paid renders a blank select.
  const paymentOptions = alreadyCancelled
    ? paymentTransitions.filter((status) => status === order.paymentStatus || status !== "paid")
    : paymentTransitions;
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

  // Only a card payment can be reversed from here. A PayNow or hand-marked order
  // has no Stripe payment to refund, and the panel can't tell which it is until
  // the cancel comes back, so never promise a refund it might not have made.
  async function handleCancel() {
    const paid = order.paymentStatus === "paid";
    // Money that has already gone back is not owed a second time, so what is
    // quoted here is what she is still holding, never the order total.
    if (
      !confirm(
        paid && netKeptCents > 0
          ? `Cancel this order and return ${formatPrice(netKeptCents)} to the customer? A card payment goes back through Stripe. A PayNow or hand-marked payment has to be sent back by you.`
          : "Cancel this order?",
      )
    )
      return;
    const result = await onCancel();
    if (!result.ok) {
      alert(result.error ?? "Could not cancel the order.");
      return;
    }
    const toSendBackCents = Math.max(0, (result.amountCents ?? order.totalCents) - refundedCents);
    if (result.manualRefundDue)
      alert(
        toSendBackCents > 0
          ? `Order cancelled. This one was not paid through Stripe, so nothing was refunded. Send ${formatPrice(toSendBackCents)} back to the customer yourself.`
          : `Order cancelled. Everything paid on it has already gone back, so there is nothing more to send.`,
      );
    else if (result.refunded) alert(`Order cancelled and refunded through Stripe.`);
    else alert("Order cancelled.");
  }

  /** Write down money that went back on an order that still stands. */
  async function handleRecordRefund() {
    const cents = Math.round(parseFloat(refundAmount || "0") * 100);
    if (!Number.isFinite(cents) || cents <= 0) {
      alert("Type how much went back to the customer.");
      return;
    }
    setRefundBusy(true);
    const result = await onRecordRefund(cents, refundReason, refundVia);
    setRefundBusy(false);
    if (!result.ok) {
      alert(result.error);
      return;
    }
    setRefundAmount("");
    setRefundReason("");
  }

  /**
   * Take lines off an order Michelle could not bake. The server refuses this
   * once the order is baking, since by then the food exists, so surface its
   * words rather than second-guessing the rule here.
   */
  async function handleRemoveItems() {
    if (removeIds.length === 0) return;
    // An order with no lines left is not an order. It would still hold a slot on
    // the day, print an empty packing slip, and never tell the customer anything.
    if (removeIds.length === order.items.length) {
      alert(
        "That is every line on the order. Cancel the order instead, so the customer is told and their points and stock go back.",
      );
      return;
    }
    if (
      !confirm(
        removeIds.length === 1
          ? "Take this line off the order? The total drops by what it cost."
          : `Take these ${removeIds.length} lines off the order? The total drops by what they cost.`,
      )
    )
      return;
    setRemoveBusy(true);
    const result = await onRemoveItems(removeIds);
    setRemoveBusy(false);
    if (!result.ok) {
      alert(result.error);
      return;
    }
    setRemoveIds([]);
    setShowRemove(false);
    // Deliberately no refund prompt here. Removing lines is only allowed while
    // the order is unpaid, so no money has changed hands and there is nothing to
    // send back: the total simply drops to what is still being made. Offering a
    // refund at this point booked the same reduction twice, once in the lowered
    // total and again as money returned.
    if (result.removedCents > 0) {
      alert(
        `Removed ${formatPrice(result.removedCents)} of items. The order total has come down to match.`,
      );
    }
  }
  /**
   * Save a corrected or first-time delivery address. Checked here for the two
   * things she can see, so a typo is caught before a round trip. Everything
   * else, including how late this is allowed and what the new postal code does
   * to the delivery fee, is the server's call.
   */
  function handleSaveAddress() {
    if (!addrLine1.trim()) {
      alert("Type the block and street.");
      return;
    }
    if (!/^\d{6}$/.test(addrPostal.trim())) {
      alert("The postal code needs to be 6 digits.");
      return;
    }
    onSetAddress({ line1: addrLine1, unit: addrUnit, postalCode: addrPostal }, addrWindow);
    setShowAddress(false);
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

        {/* A delivery with no address. On a gift it means the recipient never
            opened their link, and that link only answers once, so nobody but
            Michelle can fill this in. Left alone the packing slip goes out with
            nowhere to send the box. */}
        {missingAddress && (
          <div className="mt-3 rounded-xl border border-danger/40 bg-danger-soft p-3">
            <p className="text-sm font-semibold text-danger-ink">
              No delivery address yet. This one cannot be packed.
            </p>
            <p className="mt-0.5 text-sm text-danger-ink">
              {order.isGift
                ? "The recipient never filled in their link, and it only answers once. Ask them or the buyer for the address, then type it in here."
                : "Nothing was ever saved for this delivery. Ask the customer for the address, then type it in here."}
            </p>
            <button
              type="button"
              onClick={() => {
                setShowAddress(true);
                addrLine1Ref.current?.focus();
              }}
              className="mt-2 rounded-full bg-danger px-4 py-1.5 text-sm font-semibold text-white transition hover:brightness-110 active:scale-95"
            >
              Add the address
            </button>
          </div>
        )}

        {/* Paid late, so the customer's own date slipped by while it sat unpaid. */}
        {bakeDatePassed && (
          <div className="mt-3 rounded-xl bg-warning-soft p-3">
            <p className="text-sm font-semibold text-warning-ink">
              Paid, bake date has passed. Reschedule it.
            </p>
            <p className="mt-0.5 text-sm text-warning-ink">
              The date the customer picked, {formatLongDate(order.scheduledDate)}, has already
              gone by and this order is still open.
            </p>
            <button
              type="button"
              onClick={() => reDateRef.current?.focus()}
              className="mt-2 rounded-full border border-warning-ink/40 bg-white px-4 py-1.5 text-sm font-semibold text-warning-ink transition hover:border-warning-ink active:scale-95"
            >
              Pick a new date
            </button>
          </div>
        )}

        {/* The customer asked to cancel from their tracking page. It used to be
            written into the note, which quietly exempted the order from the
            sweep that reclaims abandoned ones, so it has its own stamp now and
            needs its own place to be seen. */}
        {order.cancellationRequestedAt && !alreadyCancelled && (
          <div className="mt-3 rounded-xl bg-danger-soft p-3">
            <p className="text-sm font-semibold text-danger-ink">
              The customer asked to cancel this order.
            </p>
            <p className="mt-0.5 text-sm text-danger-ink">
              Requested {formatLongDate(singaporeDateString(order.cancellationRequestedAt))}. Cancel
              it below, or message them if it can still go ahead.
            </p>
          </div>
        )}

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
        {/* Money returned without cancelling, so the order total alone no longer
            says what the shop kept. Both figures, so neither can be misread. */}
        {refundedCents > 0 && (
          <div className="mt-1 flex flex-col gap-1 text-sm">
            <div className="flex justify-between text-muted">
              <span>Refunded to the customer</span>
              <span>-{formatPrice(refundedCents)}</span>
            </div>
            <div className="flex justify-between font-semibold text-rose-deep">
              <span>Net kept</span>
              <span>{formatPrice(netKeptCents)}</span>
            </div>
          </div>
        )}

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
          {/* Answers to her own checkout questions. She can mark a prompt
              required, so this is where an allergy or a name to pipe arrives,
              and it belongs beside the notes rather than only in an email. */}
          {(order.noteAnswers ?? []).map((answer) => (
            <div key={answer.id} className="flex justify-between gap-3">
              <dt className="text-muted">{answer.label}</dt>
              <dd className="text-right font-semibold">{answer.answer}</dd>
            </div>
          ))}
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
            // Re-seeded whenever the stored note changes, because this field is
            // not the only writer: a customer's cancellation request is appended
            // to the same note server-side. Without the key the box would keep
            // showing whatever loaded when the modal opened.
            key={order.ownerNote ?? ""}
            defaultValue={order.ownerNote ?? ""}
            // Only write when she actually edited something. Blurring an
            // untouched box used to save the value it was seeded with, which
            // silently wiped a cancellation request that arrived in the meantime.
            onBlur={(e) => {
              if (e.target.value !== (order.ownerNote ?? "")) onOwnerNoteSave(e.target.value);
            }}
            rows={2}
            placeholder="Private reminder only you see. e.g. double-bag, nut allergy"
            className="mt-1 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm transition focus:border-rose"
          />
          <p className="mt-1 text-xs text-muted">
            Saved when you click away. The customer never sees this. Cancellation requests are
            added here too, so keep them unless you have dealt with them.
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
                disabled={alreadyCancelled}
                onChange={(e) => onStatusChange(e.target.value as OrderStatus)}
              >
                {/* Cancelling is only offered through the Cancel button below,
                    which also refunds and restocks, and delivery-only statuses
                    (like "Out for delivery") never appear on a pickup order. */}
                {statusOptions.map((status) => (
                  <option
                    key={status}
                    value={status}
                    disabled={order.paymentStatus !== "paid" && statusRequiresPayment(status)}
                  >
                    {orderStatusLabels[status]}
                  </option>
                ))}
              </select>
              {alreadyCancelled ? (
                <span className="text-xs font-normal text-muted">
                  This order is cancelled. Take a fresh order if the customer wants it again.
                </span>
              ) : (
                order.paymentStatus !== "paid" && (
                  <span className="text-xs font-normal text-muted">
                    Mark this order paid to start baking.
                  </span>
                )
              )}
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
              {alreadyCancelled && (
                <span className="text-xs font-normal text-muted">
                  A cancelled order cannot be marked paid.
                </span>
              )}
            </label>

            {advance && (
              <button
                type="button"
                onClick={() => onStatusChange(advance)}
                disabled={order.paymentStatus !== "paid" && statusRequiresPayment(advance)}
                className="rounded-full bg-rose-deep px-4 py-2 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:brightness-110 active:scale-95 disabled:pointer-events-none disabled:opacity-50"
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
                ref={reDateRef}
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

          {/* Where it is going. The gift recipient's link fills this in once and
              then closes itself, so a mistyped postal code or an old unit number
              can only be corrected from here. The rule about how late that is
              allowed lives in the database, so a refusal comes back as words
              rather than being second-guessed here. */}
          {isDelivery && !alreadyCancelled && (
            <div className="mt-4 border-t border-line pt-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold">Delivery address</p>
                <button
                  type="button"
                  onClick={() => setShowAddress((open) => !open)}
                  aria-expanded={showAddress}
                  aria-controls={`address-${order.orderNumber}`}
                  className="rounded-full border border-line bg-white px-3.5 py-1.5 text-xs font-semibold transition hover:border-rose active:scale-95"
                >
                  {showAddress ? "Close" : order.address ? "Edit address" : "Add address"}
                </button>
              </div>
              <p className="mt-1 text-xs text-muted">
                {order.address
                  ? "For a wrong unit or postal code the customer has told you about. While the order is unpaid the delivery fee is re-priced for the new address."
                  : "Nothing has been filled in yet. Type what the customer gives you over WhatsApp."}
              </p>
              {showAddress && (
                <div
                  id={`address-${order.orderNumber}`}
                  className="mt-2 flex flex-col gap-2"
                >
                  <label className="flex flex-col gap-1 text-sm font-semibold">
                    Address
                    <input
                      ref={addrLine1Ref}
                      value={addrLine1}
                      onChange={(e) => setAddrLine1(e.target.value)}
                      maxLength={200}
                      placeholder="Block and street"
                      className={cn(selectClass, "w-full")}
                    />
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="flex flex-col gap-1 text-sm font-semibold">
                      Unit
                      <input
                        value={addrUnit}
                        onChange={(e) => setAddrUnit(e.target.value)}
                        maxLength={60}
                        placeholder="#12-34 (optional)"
                        className={cn(selectClass, "w-full")}
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-sm font-semibold">
                      Postal code
                      <input
                        value={addrPostal}
                        onChange={(e) => setAddrPostal(e.target.value)}
                        inputMode="numeric"
                        maxLength={6}
                        placeholder="123456"
                        className={cn(selectClass, "w-full")}
                      />
                    </label>
                  </div>
                  <label className="flex flex-col gap-1 text-sm font-semibold">
                    Time window
                    <select
                      value={addrWindow}
                      onChange={(e) => setAddrWindow(e.target.value)}
                      className={cn(selectClass, "w-full")}
                    >
                      <option value="">Not set</option>
                      {windowOptions.map((window) => (
                        <option key={window} value={window}>
                          {window}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    onClick={handleSaveAddress}
                    className="self-start rounded-full bg-rose-deep px-4 py-2 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:brightness-110 active:scale-95"
                  >
                    Save address
                  </button>
                  <p className="text-xs text-muted">
                    {order.paymentStatus === "paid"
                      ? "This order is paid, so only the address moves. What was charged stays exactly as it is."
                      : "A new postal code can fall in a different delivery zone, so the fee and the total may change."}
                  </p>
                  {/* Saving here counts as the recipient's answer, which is what
                      stops the reminders and closes their link. Say so, because
                      it is a door shutting and she is the one shutting it. */}
                  {order.isGift && missingAddress && (
                    <p className="text-xs text-muted">
                      This counts as the recipient&rsquo;s answer. We stop asking them, and their
                      link can no longer change the address. Corrections come back here.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Chasing payment on a cancelled order would be asking for money the
              app has to hand straight back, so none of this shows once it is
              cancelled. */}
          {order.paymentStatus === "pending" && !alreadyCancelled && (
            <div className="mt-3 rounded-xl bg-warning-soft p-3">
              <p className="text-sm font-semibold text-warning-ink">
                Awaiting payment
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  // Naming the customer and the amount, because this is tapped on
                  // a phone against a list of similar names and it does a lot at
                  // once: it takes stock off the shelf, moves the customer's
                  // points, pays any referral, and books the money as today's
                  // takings. It can be undone, but only before baking starts.
                  onClick={() => {
                    const amount = formatPrice(
                      order.totalCents - (order.refundedCents ?? 0),
                    );
                    if (confirm(`Mark ${amount} received from ${order.name} for ${order.orderNumber}?`)) {
                      onPaymentChange("paid");
                    }
                  }}
                  className="rounded-full bg-success px-4 py-1.5 text-sm font-semibold text-white transition hover:brightness-110 active:scale-95"
                >
                  ✓ Mark paid
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
            </div>
          )}

          {/* Trimming what was ordered, for a line she could not bake. The rule
              about how late this is allowed lives in the database, so a refusal
              comes back as words rather than being second-guessed here. */}
          {!alreadyCancelled && order.items.length > 0 && (
            <div className="mt-4 border-t border-line pt-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold">Remove items</p>
                <button
                  type="button"
                  onClick={() => {
                    setRemoveIds([]);
                    setShowRemove((open) => !open);
                  }}
                  aria-expanded={showRemove}
                  aria-controls={`remove-${order.orderNumber}`}
                  className="rounded-full border border-line bg-white px-3.5 py-1.5 text-xs font-semibold transition hover:border-rose active:scale-95"
                >
                  {showRemove ? "Close" : "Choose items"}
                </button>
              </div>
              <p className="mt-1 text-xs text-muted">
                For a line you cannot bake, so the order says what the customer is actually
                getting. Once an order is baking the food exists, so record a refund instead.
              </p>
              {showRemove && (
                <div id={`remove-${order.orderNumber}`} className="mt-2 flex flex-col gap-2">
                  {order.items.map((item) => (
                    <label
                      key={item.key}
                      className="flex items-start gap-2 rounded-xl bg-white px-3 py-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={removeIds.includes(item.key)}
                        onChange={(e) =>
                          setRemoveIds((prev) =>
                            e.target.checked
                              ? [...prev, item.key]
                              : prev.filter((id) => id !== item.key),
                          )
                        }
                        className="mt-1 h-4 w-4 shrink-0"
                      />
                      <span className="flex-1">
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
                    </label>
                  ))}
                  <button
                    type="button"
                    onClick={handleRemoveItems}
                    disabled={removeBusy || removeIds.length === 0}
                    className="self-start rounded-full bg-rose-deep px-4 py-2 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:brightness-110 active:scale-95 disabled:pointer-events-none disabled:opacity-50"
                  >
                    {removeBusy
                      ? "Removing…"
                      : `Remove ${removeIds.length === 1 ? "1 line" : `${removeIds.length} lines`}`}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Money back without cancelling. Cancelling restocks the food and
              claws back the customer's points, which is wrong for an order that
              happened and just needs some money returned. */}
          <div className="mt-4 border-t border-line pt-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold">Money returned</p>
              <button
                type="button"
                onClick={() => setShowRefund((open) => !open)}
                aria-expanded={showRefund}
                aria-controls={`refund-${order.orderNumber}`}
                className="rounded-full border border-line bg-white px-3.5 py-1.5 text-xs font-semibold transition hover:border-rose active:scale-95"
              >
                {showRefund ? "Close" : "Record a refund"}
              </button>
            </div>
            <p className="mt-1 text-xs text-muted">
              {refundedCents > 0
                ? `${formatPrice(refundedCents)} sent back so far. ${formatPrice(netKeptCents)} of this order is still kept, which is the most that can still go back.`
                : "For a partial or goodwill refund on an order that still stands. The order keeps its items, its stock and the customer's points."}
            </p>
            {showRefund && (
              <div id={`refund-${order.orderNumber}`} className="mt-2 flex flex-col gap-2">
                <div className="flex flex-wrap gap-2">
                  <label className="flex flex-col gap-1 text-sm font-semibold">
                    Amount S$
                    <input
                      ref={refundAmountRef}
                      inputMode="decimal"
                      value={refundAmount}
                      onChange={(e) => setRefundAmount(e.target.value)}
                      placeholder="0.00"
                      className={cn(selectClass, "w-28")}
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-sm font-semibold">
                    How it went back
                    <select
                      value={refundVia}
                      onChange={(e) =>
                        setRefundVia(e.target.value === "stripe" ? "stripe" : "manual")
                      }
                      className={selectClass}
                    >
                      <option value="manual">By hand, PayNow</option>
                      <option value="stripe">Card, through Stripe</option>
                    </select>
                  </label>
                </div>
                <label className="flex flex-col gap-1 text-sm font-semibold">
                  Reason
                  <input
                    value={refundReason}
                    onChange={(e) => setRefundReason(e.target.value)}
                    maxLength={200}
                    placeholder="e.g. one tin arrived squashed"
                    className={selectClass}
                  />
                </label>
                <button
                  type="button"
                  onClick={handleRecordRefund}
                  disabled={refundBusy}
                  className="self-start rounded-full bg-rose-deep px-4 py-2 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:brightness-110 active:scale-95 disabled:pointer-events-none disabled:opacity-50"
                >
                  {refundBusy ? "Recording…" : "Record refund"}
                </button>
                <p className="text-xs text-muted">
                  This writes down that money moved, it does not move it. Send the PayNow, or
                  refund the card in Stripe, then record it here.
                </p>
              </div>
            )}
          </div>

          {!alreadyCancelled && (
            <div className="mt-4 border-t border-line pt-4">
              <button
                type="button"
                onClick={handleCancel}
                className="rounded-full border border-rose-deep px-4 py-2 text-sm font-semibold text-rose-deep transition hover:bg-blush-soft active:scale-95"
              >
                Cancel order
              </button>
              <p className="mt-2 text-xs text-muted">
                {order.paymentStatus === "paid"
                  ? "A card payment is refunded through Stripe. A PayNow or hand-marked payment cannot be refunded from here, so you send the money back yourself. Tracked stock goes back either way."
                  : "Marks the order cancelled."}
              </p>
            </div>
          )}
        </div>
        </div>
    </AdminModal>
  );
}
