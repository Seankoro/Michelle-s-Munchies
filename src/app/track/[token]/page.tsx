import type { Metadata } from "next";
import * as Sentry from "@sentry/nextjs";
import Link from "next/link";
import { getOrderByToken } from "@/lib/orders-db";
import { fetchStoreSettings } from "@/lib/settings";
import { formatPrice } from "@/lib/catalog";
import {
  earliestFulfillmentDate,
  formatLongDate,
  isChangeable,
  orderStatusLabels,
  type OrderStatus,
} from "@/lib/order";
import { buttonClasses } from "@/components/ui/Button";
import { RibbonDivider } from "@/components/ui/RibbonDivider";
import { MascotSays } from "@/components/ui/MascotSays";
import { ClearCartOnMount } from "@/components/cart/ClearCartOnMount";
import { OrderChangePanel } from "@/components/track/OrderChangePanel";
import { AddToOrderPanel } from "@/components/track/AddToOrderPanel";
import { GiftShareLink } from "@/components/track/GiftShareLink";
import { TrackReorderButton } from "@/components/track/TrackReorderButton";
import { fetchProducts, isUpcoming, toCardProduct } from "@/lib/products";
import { createServerSupabase } from "@/lib/supabase/server";
import { getShopWhatsAppNumber, buildOrderWhatsAppUrl, buildFulfillmentLabel } from "@/lib/whatsapp";
import { singaporeNow } from "@/lib/time";
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
  // Guests reach this page by token with no login, so only nudge account
  // creation when the visitor is not already signed in. These reads are
  // independent, so run them together instead of a serial waterfall.
  const [order, settings, {
    data: { user },
  }] = await Promise.all([
    getOrderByToken(token),
    fetchStoreSettings(),
    (await createServerSupabase()).auth.getUser(),
  ]);
  const signedIn = Boolean(user);

  if (!order) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-20 text-center">
        <div className="flex justify-center">
          <MascotSays lines={["Hmm, I can't find that order…"]} />
        </div>
        <h1 className="mt-6 font-display text-3xl font-semibold">Order not found</h1>
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

  // The same lead-time boundary both server actions apply, worked out once for
  // the date picker's minimum and for the gates below.
  const earliest = earliestFulfillmentDate(
    settings.leadTimeDays,
    singaporeNow(),
    settings.dailyCutoffTime,
  );
  // Inside the lead time Michelle is already shopping or baking for this order,
  // so rescheduleOrderAction and addItemsToOrderAction both refuse.
  const tooCloseToChange = order.scheduled_date < earliest;
  const changesOpen = settings.features.orderChanges && isChangeable(order.status);
  // rescheduleOrderAction also refuses a self-serve move once Michelle has
  // confirmed the order, because by then she has plans built around that day.
  const canReschedule = changesOpen && order.status === "received" && !tooCloseToChange;
  // addItemsToOrderAction also refuses once the order is paid, because the money
  // for a fixed list has already changed hands.
  const canAddItems = changesOpen && order.payment_status !== "paid" && !tooCloseToChange;

  // Showing either panel when its action can only answer with an error offers a
  // change that cannot happen, so a closed panel gives way to a plain line
  // pointing at WhatsApp, which is where a change Michelle has to agree to
  // belongs anyway. The lead time closes both panels, so it is said once rather
  // than as two cards telling the customer the same thing.
  const changeNotices: string[] = [];
  if (changesOpen && tooCloseToChange) {
    changeNotices.push("This order is too close to its date to change here.");
  } else if (changesOpen) {
    if (!canReschedule) {
      changeNotices.push("We’ve already confirmed this order, so the date is ours to move now.");
    }
    if (!canAddItems) {
      changeNotices.push("This order is already paid, so we’ll add anything extra by hand.");
    }
  }

  // Fetch the catalogue lazily and strip it to card shape so no admin-only field
  // (cost, detail copy) crosses to the client picker. A sold-out treat or a drop
  // that hasn't opened yet is left out, because addItemsToOrderAction refuses
  // those too and offering them would only produce an error.
  const addableProducts = canAddItems
    ? (await fetchProducts()).filter((p) => p.isAvailable && !isUpcoming(p)).map(toCardProduct)
    : [];

  // WhatsApp handoff. While an order is unpaid, offer a pre-filled message to the
  // shop's WhatsApp so the customer can confirm and arrange PayNow. It disappears
  // once an order is paid, the online payment path for when Stripe is switched on
  // later.
  const waNumber = getShopWhatsAppNumber();
  const needsPayment =
    !cancelled && order.payment_status !== "paid" && order.payment_status !== "refunded";
  const waHref =
    waNumber && needsPayment
      ? buildOrderWhatsAppUrl(waNumber, {
          orderNumber: order.order_number,
          items: order.items.map((item) => ({
            quantity: item.quantity,
            name: item.product_name,
            options: item.selected_options.map((o) => o.valueLabel),
          })),
          totalLabel: formatPrice(order.total_cents),
          customerName: order.customer_name,
          fulfillmentLabel: buildFulfillmentLabel(
            order.fulfillment_type,
            formatLongDate(order.scheduled_date),
            order.time_window,
          ),
        })
      : null;
  if (needsPayment && !waNumber) {
    // Never dead-end the payment step. Surface the misconfiguration to the
    // server logs while the customer still sees an explanation below.
    console.warn("[track] WHATSAPP_NUMBER is not set; showing fallback confirmation panel");
    Sentry.captureMessage("WHATSAPP_NUMBER is not set; customers see the fallback panel", "warning");
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <ClearCartOnMount />
      <div className="text-center">
        <div className="flex justify-center">
          <MascotSays
            lines={[
              // A cancelled order must never be told we are on it, which is what
              // the unpaid-or-paid pair alone would say.
              cancelled
                ? "This one's cancelled. I'm here if you need me."
                : needsPayment
                  ? "One more step and I get baking!"
                  : "I'm on it! Check back here any time.",
            ]}
          />
        </div>
        <h1 className="mt-6 font-display text-4xl font-semibold">Thank you, {firstName}!</h1>
        <p className="mt-2 text-muted">
          Order <span className="font-semibold text-ink">{order.order_number}</span>
          {/* Don't headline "Payment pending" in a pay-later flow, it reads as a
              problem. The "One more step" panel below explains the WhatsApp+PayNow
              step; only a settled state gets a suffix here. */}
          {order.payment_status === "paid" && " · Paid, thank you!"}
          {order.payment_status === "refunded" && " · Refunded"}
        </p>
        <p className="mt-1 text-sm text-muted">
          Bookmark this page to check your order status any time.
        </p>
      </div>

      {waHref && (
        <div className="mt-6 rounded-2xl border border-rose/30 bg-blush-soft/60 p-5 text-center">
          <p className="font-display text-2xl font-semibold text-rose-ink">One more step</p>
          <p className="mt-1 text-sm text-rose-ink">
            Send your order to us on WhatsApp. We&rsquo;ll confirm it and reply with PayNow details
            so you can pay by transfer, usually the same day.
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

      {!waHref && needsPayment && (
        <div className="mt-6 rounded-2xl border border-rose/30 bg-blush-soft/60 p-5 text-center">
          <p className="font-display text-2xl font-semibold text-rose-ink">One more step</p>
          <p className="mt-1 text-sm text-rose-ink">
            We&rsquo;ll message you on WhatsApp to confirm your order and share PayNow details.
            Questions in the meantime?{" "}
            <Link href="/contact" className="font-semibold underline">
              Get in touch
            </Link>
            .
          </p>
        </div>
      )}

      <RibbonDivider className="my-8" />

      {/* Status tracker */}
      {cancelled ? (
        <div className="rounded-2xl bg-marble/60 p-5 text-center font-semibold text-muted">
          This order was cancelled. Please{" "}
          <Link href="/contact" className="underline hover:text-ink">
            contact us
          </Link>{" "}
          if that&rsquo;s unexpected.
        </div>
      ) : (
        <ol className="flex flex-wrap items-center justify-center gap-x-2 gap-y-3">
          {flow.map((status, index) => {
            const done = index <= currentIndex;
            const isCurrent = index === currentIndex;
            const stepState = isCurrent ? "Current step" : done ? "Completed" : "Upcoming";
            return (
              <li
                key={status}
                aria-current={isCurrent ? "step" : undefined}
                className="flex items-center gap-2"
              >
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
                  <span className="sr-only">{stepState}: </span>
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
        <h2 className="font-display text-2xl font-semibold">
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
          {order.fulfillment_type === "pickup" && settings.pickupLocation && (
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Where</dt>
              <dd className="text-right font-semibold">{settings.pickupLocation}</dd>
            </div>
          )}
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
                {item.personalisation?.message && (
                  <span className="block text-xs text-rose-ink">
                    ✍️ &ldquo;{item.personalisation.message}&rdquo;
                  </span>
                )}
                {item.personalisation?.photoUrl && (
                  <span className="block text-xs text-muted">📎 Reference photo added</span>
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
          {order.discount_cents > 0 && (
            <div className="flex justify-between text-rose-ink">
              <dt>Discount{order.promo_code ? ` (${order.promo_code})` : ""}</dt>
              <dd>−{formatPrice(order.discount_cents)}</dd>
            </div>
          )}
          <div className="flex justify-between text-base font-semibold">
            <dt>Total</dt>
            <dd>{formatPrice(order.total_cents)}</dd>
          </div>
        </dl>
      </div>

      {order.is_gift && order.recipient_token && order.status !== "cancelled" && (
        order.recipient_scheduled_at ? (
          <div className="mt-6 rounded-2xl border border-line bg-white p-5 text-sm text-muted">
            🎁 The recipient has added their delivery details. You&rsquo;re all set!
          </div>
        ) : (
          <GiftShareLink path={`/gift/${order.recipient_token}`} />
        )
      )}

      {canReschedule && (
        <OrderChangePanel
          token={token}
          currentDate={order.scheduled_date}
          currentWindow={order.time_window}
          earliest={earliest}
          timeWindows={settings.timeWindows}
        />
      )}

      {canAddItems && <AddToOrderPanel token={token} products={addableProducts} />}

      {changeNotices.length > 0 && (
        <div className="mt-6 rounded-2xl border border-line bg-white p-6">
          <h2 className="font-display text-2xl font-semibold">Need to change something?</h2>
          <p className="mt-1 text-sm text-muted">
            {changeNotices.join(" ")} Message us and we&rsquo;ll sort it out, cancelling included.
          </p>
          {waNumber ? (
            <a
              href={`https://wa.me/${waNumber}`}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonClasses({ variant: "secondary", size: "sm", className: "mt-4" })}
            >
              Message us on WhatsApp
            </a>
          ) : (
            <Link
              href="/contact"
              className={buttonClasses({ variant: "secondary", size: "sm", className: "mt-4" })}
            >
              Get in touch
            </Link>
          )}
        </div>
      )}

      {order.is_gift && (
        <div className="mt-6 rounded-2xl bg-blush-soft/60 p-5 text-sm text-rose-ink">
          <p className="font-semibold">
            🎁 A gift{order.recipient_name ? ` for ${order.recipient_name}` : ""}
          </p>
          {order.gift_message && <p className="mt-1 italic">&ldquo;{order.gift_message}&rdquo;</p>}
          <p className="mt-1 text-rose-ink">
            We&rsquo;ll tuck in your message and leave the price off the package.
          </p>
        </div>
      )}

      {!signedIn && (
        <div className="mt-6 rounded-2xl bg-blush-soft/60 p-5 text-sm text-rose-ink">
          <p>
            ✨{" "}
            <Link href="/account/sign-up" className="font-semibold underline">
              Create an account
            </Link>{" "}
            to track all your orders{settings.features.rewards ? " and earn rewards on every order" : ""}.
          </p>
        </div>
      )}

      <div className="mt-8 flex flex-col items-center gap-4">
        {order.status === "completed" ? (
          <>
            <TrackReorderButton token={token} />
            <Link
              href="/menu"
              className="text-sm font-semibold text-rose-ink transition hover:text-rose"
            >
              Back to the menu
            </Link>
          </>
        ) : (
          <Link href="/menu" className={buttonClasses({ size: "lg" })}>
            Back to the menu
          </Link>
        )}
      </div>
    </main>
  );
}
