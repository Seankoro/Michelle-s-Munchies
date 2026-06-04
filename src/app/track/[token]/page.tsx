import type { Metadata } from "next";
import Link from "next/link";
import { getOrderByToken } from "@/lib/orders-db";
import { fetchStoreSettings } from "@/lib/settings";
import { formatPrice } from "@/lib/catalog";
import {
  earliestFulfillmentDate,
  formatLongDate,
  orderStatusLabels,
  paymentStatusLabels,
  type OrderStatus,
} from "@/lib/order";
import { buttonClasses } from "@/components/ui/Button";
import { RibbonDivider } from "@/components/ui/RibbonDivider";
import { ClearCartOnMount } from "@/components/cart/ClearCartOnMount";
import { OrderChangePanel } from "@/components/track/OrderChangePanel";
import { cn } from "@/lib/cn";

export const metadata: Metadata = {
  title: "Your order",
  robots: { index: false, follow: false },
};

const pickupFlow: OrderStatus[] = ["received", "confirmed", "baking", "ready", "completed"];
const deliveryFlow: OrderStatus[] = [
  "received",
  "confirmed",
  "baking",
  "ready",
  "out_for_delivery",
  "completed",
];

export default async function TrackOrderPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const order = await getOrderByToken(token);
  const settings = await fetchStoreSettings();

  if (!order) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-20 text-center">
        <p className="text-5xl" aria-hidden="true">🎀</p>
        <h1 className="mt-4 font-display text-3xl font-semibold">Order not found</h1>
        <p className="mt-2 text-muted">
          This tracking link may be incorrect or expired.
        </p>
        <Link href="/menu" className={buttonClasses({ className: "mt-8", size: "lg" })}>
          Back to the menu
        </Link>
      </main>
    );
  }

  const flow = order.fulfillment_type === "delivery" ? deliveryFlow : pickupFlow;
  const currentIndex = flow.indexOf(order.status);
  const cancelled = order.status === "cancelled";
  const firstName = order.customer_name.split(" ")[0];

  // WhatsApp handoff. While an order is unpaid, offer a pre-filled message to the
  // shop's WhatsApp so the customer can confirm and arrange PayNow. It disappears
  // once an order is paid, the online payment path for when Stripe is switched on
  // later.
  const waNumber = (process.env.WHATSAPP_NUMBER ?? "").replace(/[^\d]/g, "");
  const needsPayment =
    !cancelled && order.payment_status !== "paid" && order.payment_status !== "refunded";
  const waHref =
    waNumber && needsPayment
      ? `https://wa.me/${waNumber}?text=${encodeURIComponent(
          [
            `Hi Michelle's Munchies! I'd like to confirm my order ${order.order_number}.`,
            "",
            ...order.items.map(
              (item) =>
                `${item.quantity}x ${item.product_name}` +
                (item.selected_options.length > 0
                  ? ` (${item.selected_options.map((o) => o.valueLabel).join(", ")})`
                  : ""),
            ),
            `Total: ${formatPrice(order.total_cents)}`,
            "",
            `Name: ${order.customer_name}`,
            `${order.fulfillment_type === "pickup" ? "Pickup" : "Delivery"} on ${formatLongDate(order.scheduled_date)}${order.time_window ? ` ${order.time_window}` : ""}`,
          ].join("\n"),
        )}`
      : null;

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <ClearCartOnMount />
      <div className="text-center">
        <p className="text-5xl" aria-hidden="true">🎀</p>
        <h1 className="mt-4 font-display text-4xl font-semibold">Thank you, {firstName}!</h1>
        <p className="mt-2 text-muted">
          Order <span className="font-semibold text-ink">{order.order_number}</span> ·{" "}
          {paymentStatusLabels[order.payment_status]}
        </p>
        <p className="mt-1 text-sm text-muted">
          Bookmark this page to check your order status any time.
        </p>
      </div>

      {waHref && (
        <div className="mt-6 rounded-2xl border border-rose/30 bg-blush-soft/60 p-5 text-center">
          <p className="font-display text-lg font-semibold text-rose-deep">One more step</p>
          <p className="mt-1 text-sm text-rose-deep">
            Send your order to us on WhatsApp to confirm it. We reply with PayNow to settle payment.
          </p>
          <a
            href={waHref}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonClasses({ size: "lg", className: "mt-4" })}
          >
            Send my order on WhatsApp
          </a>
        </div>
      )}

      <RibbonDivider className="my-8" />

      {/* Status tracker */}
      {cancelled ? (
        <div className="rounded-2xl bg-marble/60 p-5 text-center font-semibold text-muted">
          This order was cancelled. Please contact us if that&rsquo;s unexpected.
        </div>
      ) : (
        <ol className="flex flex-wrap items-center justify-center gap-x-2 gap-y-3">
          {flow.map((status, index) => {
            const done = index <= currentIndex;
            const isCurrent = index === currentIndex;
            return (
              <li key={status} className="flex items-center gap-2">
                <span
                  className={cn(
                    "flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold",
                    done ? "bg-rose-deep text-white" : "bg-marble text-muted",
                    isCurrent && "ring-2 ring-rose ring-offset-2",
                  )}
                >
                  {done ? "✓" : index + 1}
                </span>
                <span
                  className={cn(
                    "text-sm font-semibold",
                    done ? "text-ink" : "text-muted",
                  )}
                >
                  {orderStatusLabels[status]}
                </span>
                {index < flow.length - 1 && (
                  <span className="hidden h-px w-6 bg-line sm:block" aria-hidden="true" />
                )}
              </li>
            );
          })}
        </ol>
      )}

      {/* Details */}
      <div className="mt-8 rounded-2xl border border-line bg-white p-6">
        <h2 className="font-display text-xl font-semibold">
          {order.fulfillment_type === "pickup" ? "Pickup" : "Delivery"} details
        </h2>
        <dl className="mt-3 grid gap-2 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-muted">When</dt>
            <dd className="text-right font-semibold">
              {formatLongDate(order.scheduled_date)}
              {order.time_window ? ` · ${order.time_window}` : ""}
            </dd>
          </div>
          {order.fulfillment_type === "delivery" && order.delivery_address && (
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Address</dt>
              <dd className="text-right">
                {order.delivery_address.line1}
                {order.delivery_address.unit ? `, ${order.delivery_address.unit}` : ""},
                Singapore {order.delivery_address.postalCode}
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

        <hr className="my-4 border-line" />

        <ul className="flex flex-col gap-2 text-sm">
          {order.items.map((item, index) => (
            <li key={index} className="flex justify-between gap-3">
              <span>
                <span className="font-semibold">{item.quantity}×</span> {item.product_name}
                {item.selected_options.length > 0 && (
                  <span className="text-muted">
                    {" "}
                    ({item.selected_options.map((o) => o.valueLabel).join(", ")})
                  </span>
                )}
              </span>
              <span className="font-semibold">{formatPrice(item.line_total_cents)}</span>
            </li>
          ))}
        </ul>

        <hr className="my-4 border-line" />
        <dl className="flex flex-col gap-1 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted">Subtotal</dt>
            <dd>{formatPrice(order.subtotal_cents)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted">
              {order.fulfillment_type === "pickup" ? "Pickup" : "Delivery"}
            </dt>
            <dd>{order.delivery_fee_cents === 0 ? "Free" : formatPrice(order.delivery_fee_cents)}</dd>
          </div>
          <div className="flex justify-between text-base font-semibold">
            <dt>Total</dt>
            <dd>{formatPrice(order.total_cents)}</dd>
          </div>
        </dl>
      </div>

      {settings.features.orderChanges &&
        (order.status === "received" || order.status === "confirmed") && (
          <OrderChangePanel
            token={token}
            currentDate={order.scheduled_date}
            currentWindow={order.time_window}
            earliest={earliestFulfillmentDate(
              settings.leadTimeDays,
              new Date(),
              settings.dailyCutoffTime,
            )}
            timeWindows={settings.timeWindows}
          />
        )}

      {order.is_gift && (
        <div className="mt-6 rounded-2xl bg-blush-soft/60 p-5 text-sm text-rose-deep">
          <p className="font-semibold">
            🎁 A gift{order.recipient_name ? ` for ${order.recipient_name}` : ""}
          </p>
          {order.gift_message && <p className="mt-1 italic">&ldquo;{order.gift_message}&rdquo;</p>}
          <p className="mt-1 text-rose-deep/80">
            We&rsquo;ll tuck in your message and leave the price off the package.
          </p>
        </div>
      )}

      <div className="mt-6 rounded-2xl bg-blush-soft/60 p-5 text-sm text-rose-deep">
        <p>
          🏆{" "}
          <Link href="/account/sign-up" className="font-semibold underline">
            Create an account
          </Link>{" "}
          to track all your orders{settings.features.rewards ? " and earn rewards on every order" : ""}.
        </p>
      </div>

      <div className="mt-8 text-center">
        <Link href="/menu" className={buttonClasses({ size: "lg" })}>
          Back to the menu
        </Link>
      </div>
    </main>
  );
}
