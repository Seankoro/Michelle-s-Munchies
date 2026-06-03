"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatPrice } from "@/lib/catalog";
import { formatLongDate, LAST_ORDER_KEY, type PlacedOrder } from "@/lib/order";
import { buttonClasses } from "@/components/ui/Button";
import { RibbonDivider } from "@/components/ui/RibbonDivider";
import { useFeatures } from "@/components/features/FeaturesProvider";

export default function CheckoutSuccessPage() {
  const [order, setOrder] = useState<PlacedOrder | null>(null);
  const [loaded, setLoaded] = useState(false);
  const features = useFeatures();

  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(LAST_ORDER_KEY);
      if (raw) setOrder(JSON.parse(raw) as PlacedOrder);
    } catch {
      // Ignore — fall through to the generic message.
    }
    setLoaded(true);
  }, []);

  if (!loaded) {
    return <main className="mx-auto max-w-2xl px-6 py-16 text-center text-muted">Loading…</main>;
  }

  if (!order) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-20 text-center">
        <p className="text-5xl" aria-hidden="true">🎀</p>
        <h1 className="mt-4 font-display text-3xl font-semibold">No recent order found</h1>
        <p className="mt-2 text-muted">Your order details may have expired.</p>
        <Link href="/menu" className={buttonClasses({ className: "mt-8", size: "lg" })}>
          Back to the menu
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <div className="text-center">
        <p className="text-5xl" aria-hidden="true">🎀</p>
        <h1 className="mt-4 font-display text-4xl font-semibold">Thank you, {order.name.split(" ")[0]}!</h1>
        <p className="mt-2 text-muted">
          Your order is in. Order number{" "}
          <span className="font-semibold text-ink">{order.orderNumber}</span>.
        </p>
      </div>

      <RibbonDivider className="my-8" />

      <div className="rounded-2xl border border-line bg-white p-6">
        <h2 className="font-display text-xl font-semibold">
          {order.fulfillmentType === "pickup" ? "Pickup" : "Delivery"} details
        </h2>
        <dl className="mt-3 grid gap-2 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-muted">When</dt>
            <dd className="text-right font-semibold">
              {formatLongDate(order.scheduledDate)} · {order.timeWindow}
            </dd>
          </div>
          {order.fulfillmentType === "delivery" && order.address && (
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Address</dt>
              <dd className="text-right">
                {order.address.line1}
                {order.address.unit ? `, ${order.address.unit}` : ""}, Singapore{" "}
                {order.address.postalCode}
              </dd>
            </div>
          )}
          <div className="flex justify-between gap-3">
            <dt className="text-muted">Contact</dt>
            <dd className="text-right">
              {order.email} · {order.phone}
            </dd>
          </div>
          {order.notes && (
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Notes</dt>
              <dd className="text-right">{order.notes}</dd>
            </div>
          )}
        </dl>

        <hr className="my-4 border-line" />

        <ul className="flex flex-col gap-2 text-sm">
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

        <hr className="my-4 border-line" />
        <dl className="flex flex-col gap-1 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted">Subtotal</dt>
            <dd>{formatPrice(order.subtotalCents)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted">
              {order.fulfillmentType === "pickup" ? "Pickup" : "Delivery"}
            </dt>
            <dd>{order.deliveryFeeCents === 0 ? "Free" : formatPrice(order.deliveryFeeCents)}</dd>
          </div>
          <div className="flex justify-between text-base font-semibold">
            <dt>Total</dt>
            <dd>{formatPrice(order.totalCents)}</dd>
          </div>
        </dl>
      </div>

      {/* What's next + rewards teaser */}
      <div className="mt-6 rounded-2xl bg-blush-soft/60 p-5 text-sm text-rose-deep">
        <p className="font-semibold">What happens next?</p>
        <p className="mt-1">
          Michelle will confirm and start baking. You&rsquo;ll get email updates through to
          ready-for-collection.
        </p>
        <p className="mt-3">
          🏆{" "}
          <Link href="/account/sign-up" className="font-semibold underline">
            Create an account
          </Link>{" "}
          to track your orders{features.rewards ? " and earn rewards on every order" : ""}.
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
