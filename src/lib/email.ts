import "server-only";
import * as Sentry from "@sentry/nextjs";
import { Resend } from "resend";
import { formatLongDate, orderStatusLabels, type OrderStatus } from "@/lib/order";
import { formatPrice } from "@/lib/catalog";
import { getShopWhatsAppNumber, buildOrderWhatsAppUrl, buildFulfillmentLabel } from "@/lib/whatsapp";
import { escapeHtml } from "@/lib/text";

let cached: Resend | null = null;

function getResend(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  if (!cached) cached = new Resend(key);
  return cached;
}

const FROM = process.env.RESEND_FROM_EMAIL ?? "Michelle's Munchies <onboarding@resend.dev>";
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

/** Minimal data each email needs, a subset of an order. */
export type OrderEmailData = {
  orderNumber: string;
  trackingToken: string;
  name: string;
  email: string;
  items: {
    name: string;
    quantity: number;
    unitPriceCents: number;
    selectedOptions: { valueLabel: string }[];
  }[];
  subtotalCents: number;
  deliveryFeeCents: number;
  /** Combined promo + points discount already applied to totalCents. */
  discountCents?: number;
  promoCode?: string | null;
  totalCents: number;
  fulfillmentType: "pickup" | "delivery";
  scheduledDate: string;
  timeWindow: string;
  isGift?: boolean;
  giftMessage?: string;
  recipientName?: string;
  noteAnswers?: { label: string; answer: string }[];
};

/** Pretty gift callout. `forOwner` adds the "include a card, no receipt" reminder. */
function giftBlock(order: OrderEmailData, forOwner: boolean): string {
  if (!order.isGift) return "";
  const recipient = order.recipientName ? escapeHtml(order.recipientName) : "someone special";
  const message = order.giftMessage
    ? `<p style="margin:8px 0 0;font-style:italic">&ldquo;${escapeHtml(order.giftMessage)}&rdquo;</p>`
    : "";
  const ownerNote = forOwner
    ? `<p style="margin:8px 0 0;font-size:13px;color:#8b746d">Please include a handwritten card and leave the price off anything in the package.</p>`
    : "";
  return `<div style="background:#ffe3e8;border-radius:12px;padding:14px 16px;margin:12px 0">
      <p style="margin:0;font-weight:700">🎁 ${forOwner ? "Gift order" : `A gift for ${recipient}`}</p>
      ${forOwner ? `<p style="margin:6px 0 0">For: <strong>${recipient}</strong></p>` : ""}
      ${message}
      ${ownerNote}
    </div>`;
}

/** Renders any answered structured note prompts, escaped. */
function noteAnswersBlock(order: OrderEmailData): string {
  const answers = (order.noteAnswers ?? []).filter((a) => a.answer && a.answer.trim());
  if (answers.length === 0) return "";
  const rows = answers
    .map(
      (a) =>
        `<li style="padding:2px 0"><strong>${escapeHtml(a.label)}:</strong> ${escapeHtml(a.answer)}</li>`,
    )
    .join("");
  return `<div style="background:#fbeef1;border-radius:12px;padding:12px 16px;margin:12px 0">
      <p style="margin:0 0 4px;font-weight:700">Order details</p>
      <ul style="margin:0;padding-left:18px">${rows}</ul>
    </div>`;
}

function shell(heading: string, bodyHtml: string, trackingToken?: string): string {
  const trackUrl = trackingToken ? `${SITE_URL}/track/${trackingToken}` : null;
  return `
  <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#fff7f9;padding:24px;color:#3d2823">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #f1dbe0;border-radius:18px;overflow:hidden">
      <div style="background:#ffe3e8;padding:20px 24px;text-align:center">
        <div style="font-size:22px;font-weight:700"><img src="${SITE_URL}/logo.png" alt="" width="34" height="34" style="vertical-align:middle;margin-right:8px"/>Michelle&rsquo;s Munchies</div>
      </div>
      <div style="padding:24px">
        <h1 style="font-size:20px;margin:0 0 12px">${heading}</h1>
        ${bodyHtml}
        ${
          trackUrl
            ? `<p style="margin:24px 0 0;text-align:center">
                 <a href="${trackUrl}" style="display:inline-block;background:#bc4a6a;color:#fff;text-decoration:none;font-weight:700;padding:12px 24px;border-radius:999px">Track your order</a>
               </p>`
            : ""
        }
      </div>
      <div style="padding:16px 24px;border-top:1px solid #f1dbe0;color:#8b746d;font-size:12px;text-align:center">
        Michelle&rsquo;s Munchies · Singapore
      </div>
    </div>
  </div>`;
}

function itemRows(order: OrderEmailData): string {
  const rows = order.items
    .map((item) => {
      const opts =
        item.selectedOptions.length > 0
          ? ` <span style="color:#8b746d">(${item.selectedOptions.map((o) => escapeHtml(o.valueLabel)).join(", ")})</span>`
          : "";
      return `<tr>
        <td style="padding:4px 0">${item.quantity}× ${escapeHtml(item.name)}${opts}</td>
        <td style="padding:4px 0;text-align:right">${formatPrice(item.unitPriceCents * item.quantity)}</td>
      </tr>`;
    })
    .join("");

  return `<table style="width:100%;border-collapse:collapse;font-size:14px;margin:12px 0">
    ${rows}
    <tr><td colspan="2" style="border-top:1px solid #f1dbe0;padding-top:8px"></td></tr>
    <tr><td style="color:#8b746d">Subtotal</td><td style="text-align:right">${formatPrice(order.subtotalCents)}</td></tr>
    <tr><td style="color:#8b746d">${order.fulfillmentType === "pickup" ? "Pickup" : "Delivery"}</td>
        <td style="text-align:right">${order.deliveryFeeCents === 0 ? "Free" : formatPrice(order.deliveryFeeCents)}</td></tr>
    ${
      order.discountCents && order.discountCents > 0
        ? `<tr><td style="color:#bc4a6a">Discount${order.promoCode ? ` (${escapeHtml(order.promoCode)})` : ""}</td>
        <td style="text-align:right;color:#bc4a6a">−${formatPrice(order.discountCents)}</td></tr>`
        : ""
    }
    <tr><td style="font-weight:700">Total</td><td style="text-align:right;font-weight:700">${formatPrice(order.totalCents)}</td></tr>
  </table>`;
}

async function send(to: string, subject: string, html: string): Promise<void> {
  const resend = getResend();
  if (!resend) {
    console.warn(`[email] RESEND_API_KEY not set, skipping "${subject}" to ${to}`);
    return;
  }
  try {
    const { error } = await resend.emails.send({ from: FROM, to, subject, html });
    if (error) {
      console.error(`[email] Resend rejected "${subject}" to ${to}:`, error);
      Sentry.captureMessage(`Resend rejected "${subject}"`, {
        level: "error",
        extra: { to, error },
      });
    }
  } catch (error) {
    // Email must never break the order flow. Log, report, and move on so the
    // customer's order still succeeds while Michelle finds out something broke.
    console.error(`[email] Failed to send "${subject}" to ${to}:`, error);
    Sentry.captureException(error, { extra: { subject, to } });
  }
}

/** Customer confirmation + owner alert, sent when an order is placed. */
export async function sendOrderEmails(order: OrderEmailData): Promise<void> {
  const fulfilment =
    order.fulfillmentType === "pickup" ? "Self-pickup" : "Delivery";

  // Orders are unpaid at placement, nothing happens until the customer
  // confirms on WhatsApp. This email is the safety net for anyone who closed
  // the tab before tapping the WhatsApp button on the tracking page, so it
  // must carry the same confirm link, not imply baking has started.
  const waNumber = getShopWhatsAppNumber();
  const waUrl = waNumber
    ? buildOrderWhatsAppUrl(waNumber, {
        orderNumber: order.orderNumber,
        items: order.items.map((item) => ({
          quantity: item.quantity,
          name: item.name,
          options: item.selectedOptions.map((o) => o.valueLabel),
        })),
        totalLabel: formatPrice(order.totalCents),
        customerName: order.name,
        fulfillmentLabel: buildFulfillmentLabel(
          order.fulfillmentType,
          formatLongDate(order.scheduledDate),
          order.timeWindow,
        ),
      })
    : null;
  const confirmBlock = waUrl
    ? `<div style="background:#ffe3e8;border-radius:12px;padding:16px;margin:12px 0;text-align:center">
        <p style="margin:0;font-weight:700">One more step</p>
        <p style="margin:6px 0 12px;font-size:14px">Send your order to us on WhatsApp. We&rsquo;ll confirm it and reply with PayNow details so you can pay by transfer.</p>
        <a href="${waUrl}" style="display:inline-block;background:#bc4a6a;color:#fff;text-decoration:none;font-weight:700;padding:12px 24px;border-radius:999px">Confirm on WhatsApp</a>
      </div>`
    : "";

  const customerBody = `
    <p>Hi ${escapeHtml(order.name.split(" ")[0])}, thanks for your order! We&rsquo;ve received it, and once it&rsquo;s confirmed on WhatsApp, Michelle starts baking.</p>
    ${confirmBlock}
    <p style="margin:8px 0"><strong>Order ${order.orderNumber}</strong><br/>
      ${fulfilment} · ${formatLongDate(order.scheduledDate)} · ${escapeHtml(order.timeWindow)}</p>
    ${giftBlock(order, false)}
    ${itemRows(order)}`;
  await send(order.email, `We got your order, ${order.orderNumber}`, shell("Order received 🎀", customerBody, order.trackingToken));

  const owner = process.env.OWNER_NOTIFICATION_EMAIL;
  if (owner) {
    const ownerBody = `
      <p>New order from <strong>${escapeHtml(order.name)}</strong> (${escapeHtml(order.email)}).</p>
      <p style="margin:8px 0"><strong>Order ${order.orderNumber}</strong><br/>
        ${fulfilment} · ${formatLongDate(order.scheduledDate)} · ${escapeHtml(order.timeWindow)}</p>
      ${giftBlock(order, true)}
      ${noteAnswersBlock(order)}
      ${itemRows(order)}`;
    await send(owner, `${order.isGift ? "New gift order" : "New order"}: ${order.orderNumber}`, shell("New order received", ownerBody));
  }
}

/** One warm line per status, these are the emails customers actually enjoy. */
const statusLines: Partial<Record<OrderStatus, string>> = {
  received: "your order is in Michelle's bake book.",
  confirmed: "your order is confirmed and on Michelle's baking list.",
  baking: "your treats are in the oven right now.",
  ready: "everything is boxed up and tied with a bow. See you soon!",
  out_for_delivery: "your box is on its way to you.",
  completed: "we hope every bite was worth it. Come back hungry!",
};

/** Customer notification when Michelle advances the order's status. */
export async function sendStatusEmail(params: {
  orderNumber: string;
  trackingToken: string;
  name: string;
  email: string;
  status: OrderStatus;
}): Promise<void> {
  const label = orderStatusLabels[params.status];
  const line = statusLines[params.status] ?? "here&rsquo;s an update on your order.";
  const body = `
    <p>Hi ${escapeHtml(params.name.split(" ")[0])}, ${line}</p>
    <p style="margin:8px 0"><strong>Order ${params.orderNumber}</strong> is now
      <strong style="color:#bc4a6a">${label}</strong>.</p>`;
  await send(params.email, `Order ${params.orderNumber}: ${label}`, shell("Order update", body, params.trackingToken));
}

/** Customer notification when an order is cancelled, with the refund status. */
export async function sendOrderCancelledEmail(params: {
  orderNumber: string;
  trackingToken: string;
  name: string;
  email: string;
  refunded: boolean;
}): Promise<void> {
  const refundLine = params.refunded
    ? `<p style="margin:8px 0">Your payment has been refunded. It should appear back on your card within a few business days.</p>`
    : `<p style="margin:8px 0">If you had already paid, we&rsquo;ll be in touch about the refund. Reply here or message us on WhatsApp any time.</p>`;
  const body = `
    <p>Hi ${escapeHtml(params.name.split(" ")[0])}, your order has been cancelled.</p>
    <p style="margin:8px 0"><strong>Order ${params.orderNumber}</strong> is now
      <strong style="color:#bc4a6a">cancelled</strong>.</p>
    ${refundLine}`;
  await send(
    params.email,
    `Order ${params.orderNumber}: cancelled`,
    shell("Order cancelled", body, params.trackingToken),
  );
}

/** Customer notification when Michelle moves an order's bake date or window. */
export async function sendRescheduleEmail(params: {
  orderNumber: string;
  trackingToken: string;
  name: string;
  email: string;
  scheduledDate: string;
  timeWindow: string;
}): Promise<void> {
  const when = `${formatLongDate(params.scheduledDate)}${params.timeWindow ? ` · ${escapeHtml(params.timeWindow)}` : ""}`;
  const body = `
    <p>Hi ${escapeHtml(params.name.split(" ")[0])}, heads up: we&rsquo;ve moved your order to a new date.</p>
    <p style="margin:8px 0"><strong>Order ${params.orderNumber}</strong> is now set for
      <strong style="color:#bc4a6a">${when}</strong>.</p>
    <p style="margin:8px 0;font-size:13px;color:#8b746d">If this doesn&rsquo;t work for you, just reply or reach out on WhatsApp and we&rsquo;ll sort it out.</p>`;
  await send(params.email, `Order ${params.orderNumber}: new date`, shell("Order rescheduled", body, params.trackingToken));
}

/** After a completed order, invite the buyer to review the treats they bought. */
export async function sendReviewRequestEmail(params: {
  to: string;
  name: string;
  orderNumber: string;
  products: { name: string; slug: string }[];
}): Promise<void> {
  if (params.products.length === 0) return;
  const links = params.products
    .map(
      (p) =>
        `<li style="padding:4px 0"><a href="${SITE_URL}/menu/${p.slug}" style="color:#bc4a6a;font-weight:700;text-decoration:none">${escapeHtml(p.name)}</a></li>`,
    )
    .join("");
  const body = `
    <p>Hi ${escapeHtml(params.name.split(" ")[0])}, we hope every bite of order ${params.orderNumber} was worth it!</p>
    <p style="margin:8px 0">A quick star rating helps other customers and means the world to a small home bakery. Tap a treat to leave a review:</p>
    <ul style="margin:8px 0;padding-left:18px">${links}</ul>`;
  await send(params.to, "How were your treats? 🎀", shell("Leave a review", body));
}

/** Tell the owner a customer added items to an existing order. */
export async function sendItemsAddedEmail(
  orderNumber: string,
  customerName: string,
  addedItems: string[],
): Promise<void> {
  const owner = process.env.OWNER_NOTIFICATION_EMAIL;
  if (!owner || addedItems.length === 0) return;
  const list = addedItems
    .map((line) => `<li style="padding:2px 0">${escapeHtml(line)}</li>`)
    .join("");
  const body = `
    <p><strong>${escapeHtml(customerName)}</strong> added items to order ${orderNumber}:</p>
    <ul style="margin:8px 0;padding-left:18px">${list}</ul>
    <p style="font-size:13px;color:#8b746d">The order total was updated. Same date and delivery.</p>`;
  await send(owner, `Items added to ${orderNumber}`, shell("Order updated", body));
}

/** Tell the owner a gift recipient has filled in their delivery details. */
export async function sendGiftScheduledEmail(
  orderNumber: string,
  recipientName: string | null,
  address: { line1: string; unit?: string; postalCode: string },
  timeWindow: string,
): Promise<void> {
  const owner = process.env.OWNER_NOTIFICATION_EMAIL;
  if (!owner) return;
  const who = recipientName?.trim() ? escapeHtml(recipientName.trim()) : "The recipient";
  const line = `${escapeHtml(address.line1)}${address.unit ? `, ${escapeHtml(address.unit)}` : ""}, Singapore ${escapeHtml(address.postalCode)}`;
  const body = `
    <p><strong>${who}</strong> confirmed delivery details for gift order ${orderNumber}:</p>
    <p style="margin:8px 0"><strong>When:</strong> ${escapeHtml(timeWindow)}</p>
    <p style="margin:8px 0"><strong>Where:</strong> ${line}</p>`;
  await send(owner, `Gift ${orderNumber} scheduled`, shell("Gift details confirmed", body));
}

/** Warm nudge for a customer who hasn't ordered in a while. */
export async function sendWinbackEmail(to: string, name: string): Promise<void> {
  const first = (name || "there").split(" ")[0];
  const body = `
    <p>Hi ${escapeHtml(first)}, it&rsquo;s been a while! Michelle has been baking up a storm and we&rsquo;d love to treat you again.</p>
    <p style="margin:24px 0 0;text-align:center">
      <a href="${SITE_URL}/menu" style="display:inline-block;background:#bc4a6a;color:#fff;text-decoration:none;font-weight:700;padding:12px 24px;border-radius:999px">See what&rsquo;s fresh</a>
    </p>`;
  await send(to, "We miss you at Michelle's Munchies 🎀", shell("Come back for a treat", body));
}

/** Reminder that a saved occasion is coming up, with a nudge to reorder in time. */
export async function sendOccasionReminderEmail(
  to: string,
  name: string,
  label: string,
  daysBefore: number,
): Promise<void> {
  const first = (name || "there").split(" ")[0];
  const when =
    daysBefore <= 0
      ? "is today"
      : daysBefore === 1
        ? "is tomorrow"
        : `is in ${daysBefore} days`;
  const body = `
    <p>Hi ${escapeHtml(first)}, a little reminder: <strong>${escapeHtml(label)}</strong> ${when}. 🎀</p>
    <p>Order now so Michelle has time to bake something special. Lead times mean the earlier the better!</p>
    <p style="margin:24px 0 0;text-align:center">
      <a href="${SITE_URL}/menu" style="display:inline-block;background:#bc4a6a;color:#fff;text-decoration:none;font-weight:700;padding:12px 24px;border-radius:999px">Order a treat</a>
    </p>`;
  await send(to, `${label} is coming up 🎀`, shell("A treat-worthy date is near", body));
}

/** Gentle nudge for a cart that was started but not checked out. */
export async function sendAbandonedCartEmail(
  to: string,
  items: { name: string; quantity: number }[],
): Promise<void> {
  const list = items
    .map((i) => `<li style="padding:2px 0">${i.quantity}× ${escapeHtml(i.name)}</li>`)
    .join("");
  const body = `
    <p>You left some treats in your cart. They&rsquo;re still waiting for you! 🎀</p>
    <ul style="margin:8px 0;padding-left:18px">${list}</ul>
    <p style="margin:24px 0 0;text-align:center">
      <a href="${SITE_URL}/cart" style="display:inline-block;background:#bc4a6a;color:#fff;text-decoration:none;font-weight:700;padding:12px 24px;border-radius:999px">Finish your order</a>
    </p>`;
  await send(to, "Still thinking it over? 🎀", shell("Your cart is waiting", body));
}

/** Send one newsletter email with an unsubscribe link in the footer. */
export async function sendNewsletterEmail(
  to: string,
  subject: string,
  bodyHtml: string,
  unsubscribeToken: string,
): Promise<void> {
  const unsubUrl = `${SITE_URL}/unsubscribe?token=${unsubscribeToken}`;
  const body = `${bodyHtml}
    <p style="margin:24px 0 0;font-size:12px;color:#8b746d;text-align:center">
      You're getting this because you signed up at Michelle's Munchies.
      <a href="${unsubUrl}" style="color:#8b746d">Unsubscribe</a>.
    </p>`;
  await send(to, subject, shell(subject, body));
}

/** Owner alert, a customer has asked to cancel an order. */
export async function sendCancellationRequestEmail(
  orderNumber: string,
  customerName: string,
): Promise<void> {
  const owner = process.env.OWNER_NOTIFICATION_EMAIL;
  if (!owner) return;
  const body = `
    <p><strong>${escapeHtml(customerName)}</strong> has asked to cancel order
      <strong>${escapeHtml(orderNumber)}</strong>.</p>
    <p style="margin:8px 0">Review it in Admin and cancel plus refund if you are happy to.</p>`;
  await send(owner, `Cancellation request: ${orderNumber}`, shell("Cancellation request", body));
}

/** Owner alert when a tracked product runs low on stock. */
export async function sendLowStockEmail(
  to: string,
  productName: string,
  remaining: number,
): Promise<void> {
  const body = `
    <p><strong>${escapeHtml(productName)}</strong> is running low.</p>
    <p style="margin:8px 0">${remaining === 0 ? "It just sold out and is now hidden from the menu." : `Only ${remaining} left in stock.`}</p>
    <p style="margin:8px 0">Top up the count in Admin when you bake more.</p>`;
  await send(to, `Low stock: ${productName}`, shell("Low stock alert", body));
}

/** Birthday greeting + reward-points note. */
export async function sendBirthdayEmail(to: string, points: number): Promise<void> {
  const body = `
    <p>Happy birthday from Michelle&rsquo;s Munchies! 🎂</p>
    <p style="margin:8px 0">We&rsquo;ve popped <strong>${points} reward points</strong> into your
      account as a little treat. Enjoy something sweet on us.</p>
    <p style="margin:24px 0 0;text-align:center">
      <a href="${SITE_URL}/menu" style="display:inline-block;background:#bc4a6a;color:#fff;text-decoration:none;font-weight:700;padding:12px 24px;border-radius:999px">Treat yourself</a>
    </p>`;
  await send(to, "Happy birthday! 🎂 A treat from us", shell("Happy birthday!", body));
}

/** "It's back!" email when a previously sold-out product is available again. */
export async function sendBackInStockEmail(
  to: string,
  productName: string,
  slug: string,
): Promise<void> {
  const url = `${SITE_URL}/menu/${slug}`;
  const body = `
    <p>Good news! <strong>${escapeHtml(productName)}</strong> is back in stock.</p>
    <p style="margin:8px 0">Pop back in to order before it sells out again.</p>
    <p style="margin:24px 0 0;text-align:center">
      <a href="${url}" style="display:inline-block;background:#bc4a6a;color:#fff;text-decoration:none;font-weight:700;padding:12px 24px;border-radius:999px">Order now</a>
    </p>`;
  await send(to, `${productName} is back! 🎀`, shell("Back in stock", body));
}

/**
 * Double-opt-in confirmation. Sent when someone subscribes to the newsletter
 * or a back-in-stock alert; nothing else is ever sent to the address until the
 * link is clicked, so nobody can sign up somebody else's inbox.
 */
export async function sendSubscriptionConfirmEmail(
  to: string,
  kind: { list: "newsletter" } | { list: "stock"; productName: string },
  confirmToken: string,
): Promise<void> {
  const url = `${SITE_URL}/confirm/${confirmToken}`;
  const what =
    kind.list === "newsletter"
      ? "our newsletter"
      : `the back-in-stock alert for <strong>${escapeHtml(kind.productName)}</strong>`;
  const body = `
    <p>Someone (hopefully you!) asked to join ${what}.</p>
    <p style="margin:8px 0">Tap the button below to confirm. If this wasn&rsquo;t you, just ignore this email and we won&rsquo;t send another thing.</p>
    <p style="margin:24px 0 0;text-align:center">
      <a href="${url}" style="display:inline-block;background:#bc4a6a;color:#fff;text-decoration:none;font-weight:700;padding:12px 24px;border-radius:999px">Confirm my email</a>
    </p>`;
  await send(to, "Please confirm your email 🎀", shell("One quick tap", body));
}
