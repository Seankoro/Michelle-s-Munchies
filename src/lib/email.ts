import "server-only";
import { Resend } from "resend";
import { orderStatusLabels, type OrderStatus } from "@/lib/order";
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

function money(cents: number): string {
  return `S$${(cents / 100).toFixed(2)}`;
}

/** Minimal data each email needs (a subset of an order). */
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
    ? `<p style="margin:8px 0 0;font-size:13px;color:#8a767e">Please include a handwritten card and leave the price off anything in the package.</p>`
    : "";
  return `<div style="background:#fae3ea;border-radius:12px;padding:14px 16px;margin:12px 0">
      <p style="margin:0;font-weight:700">🎁 ${forOwner ? "Gift order" : `A gift for ${recipient}`}</p>
      ${forOwner ? `<p style="margin:6px 0 0">For: <strong>${recipient}</strong></p>` : ""}
      ${message}
      ${ownerNote}
    </div>`;
}

/** Renders any answered structured note prompts (escaped). */
function noteAnswersBlock(order: OrderEmailData): string {
  const answers = (order.noteAnswers ?? []).filter((a) => a.answer && a.answer.trim());
  if (answers.length === 0) return "";
  const rows = answers
    .map(
      (a) =>
        `<li style="padding:2px 0"><strong>${escapeHtml(a.label)}:</strong> ${escapeHtml(a.answer)}</li>`,
    )
    .join("");
  return `<div style="background:#f4f0ec;border-radius:12px;padding:12px 16px;margin:12px 0">
      <p style="margin:0 0 4px;font-weight:700">Order details</p>
      <ul style="margin:0;padding-left:18px">${rows}</ul>
    </div>`;
}

function shell(heading: string, bodyHtml: string, trackingToken?: string): string {
  const trackUrl = trackingToken ? `${SITE_URL}/track/${trackingToken}` : null;
  return `
  <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#fdf8f4;padding:24px;color:#4a3a40">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #ece1e5;border-radius:18px;overflow:hidden">
      <div style="background:#fae3ea;padding:20px 24px;text-align:center">
        <div style="font-size:22px;font-weight:700">🎀 Michelle&rsquo;s Munchies</div>
      </div>
      <div style="padding:24px">
        <h1 style="font-size:20px;margin:0 0 12px">${heading}</h1>
        ${bodyHtml}
        ${
          trackUrl
            ? `<p style="margin:24px 0 0;text-align:center">
                 <a href="${trackUrl}" style="display:inline-block;background:#b8466f;color:#fff;text-decoration:none;font-weight:700;padding:12px 24px;border-radius:999px">Track your order</a>
               </p>`
            : ""
        }
      </div>
      <div style="padding:16px 24px;border-top:1px solid #ece1e5;color:#8a767e;font-size:12px;text-align:center">
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
          ? ` <span style="color:#8a767e">(${item.selectedOptions.map((o) => o.valueLabel).join(", ")})</span>`
          : "";
      return `<tr>
        <td style="padding:4px 0">${item.quantity}× ${item.name}${opts}</td>
        <td style="padding:4px 0;text-align:right">${money(item.unitPriceCents * item.quantity)}</td>
      </tr>`;
    })
    .join("");

  return `<table style="width:100%;border-collapse:collapse;font-size:14px;margin:12px 0">
    ${rows}
    <tr><td colspan="2" style="border-top:1px solid #ece1e5;padding-top:8px"></td></tr>
    <tr><td style="color:#8a767e">Subtotal</td><td style="text-align:right">${money(order.subtotalCents)}</td></tr>
    <tr><td style="color:#8a767e">${order.fulfillmentType === "pickup" ? "Pickup" : "Delivery"}</td>
        <td style="text-align:right">${order.deliveryFeeCents === 0 ? "Free" : money(order.deliveryFeeCents)}</td></tr>
    <tr><td style="font-weight:700">Total</td><td style="text-align:right;font-weight:700">${money(order.totalCents)}</td></tr>
  </table>`;
}

async function send(to: string, subject: string, html: string): Promise<void> {
  const resend = getResend();
  if (!resend) {
    console.warn(`[email] RESEND_API_KEY not set — skipping "${subject}" to ${to}`);
    return;
  }
  try {
    const { error } = await resend.emails.send({ from: FROM, to, subject, html });
    if (error) {
      console.error(`[email] Resend rejected "${subject}" to ${to}:`, error);
    }
  } catch (error) {
    // Email must never break the order flow — log and move on.
    console.error(`[email] Failed to send "${subject}" to ${to}:`, error);
  }
}

/** Customer confirmation + owner alert, sent when an order is placed. */
export async function sendOrderEmails(order: OrderEmailData): Promise<void> {
  const fulfilment =
    order.fulfillmentType === "pickup" ? "Self-pickup" : "Delivery";

  const customerBody = `
    <p>Hi ${order.name.split(" ")[0]}, thanks for your order! We&rsquo;ve received it and will start baking.</p>
    <p style="margin:8px 0"><strong>Order ${order.orderNumber}</strong><br/>
      ${fulfilment} · ${order.scheduledDate} · ${order.timeWindow}</p>
    ${giftBlock(order, false)}
    ${itemRows(order)}`;
  await send(order.email, `We got your order, ${order.orderNumber}`, shell("Order received 🎀", customerBody, order.trackingToken));

  const owner = process.env.OWNER_NOTIFICATION_EMAIL;
  if (owner) {
    const ownerBody = `
      <p>New order from <strong>${order.name}</strong> (${order.email}).</p>
      <p style="margin:8px 0"><strong>Order ${order.orderNumber}</strong><br/>
        ${fulfilment} · ${order.scheduledDate} · ${order.timeWindow}</p>
      ${giftBlock(order, true)}
      ${noteAnswersBlock(order)}
      ${itemRows(order)}`;
    await send(owner, `${order.isGift ? "New gift order" : "New order"}: ${order.orderNumber}`, shell("New order received", ownerBody));
  }
}

/** Customer notification when Michelle advances the order's status. */
export async function sendStatusEmail(params: {
  orderNumber: string;
  trackingToken: string;
  name: string;
  email: string;
  status: OrderStatus;
}): Promise<void> {
  const label = orderStatusLabels[params.status];
  const body = `
    <p>Hi ${params.name.split(" ")[0]}, here&rsquo;s an update on your order.</p>
    <p style="margin:8px 0"><strong>Order ${params.orderNumber}</strong> is now
      <strong style="color:#b8466f">${label}</strong>.</p>`;
  await send(params.email, `Order ${params.orderNumber}: ${label}`, shell("Order update", body, params.trackingToken));
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
      <a href="${SITE_URL}/cart" style="display:inline-block;background:#b8466f;color:#fff;text-decoration:none;font-weight:700;padding:12px 24px;border-radius:999px">Finish your order</a>
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
    <p style="margin:24px 0 0;font-size:12px;color:#8a767e;text-align:center">
      You're getting this because you signed up at Michelle's Munchies.
      <a href="${unsubUrl}" style="color:#8a767e">Unsubscribe</a>.
    </p>`;
  await send(to, subject, shell(subject, body));
}

/** Owner alert: a customer has asked to cancel an order. */
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
      <a href="${SITE_URL}/menu" style="display:inline-block;background:#b8466f;color:#fff;text-decoration:none;font-weight:700;padding:12px 24px;border-radius:999px">Treat yourself</a>
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
      <a href="${url}" style="display:inline-block;background:#b8466f;color:#fff;text-decoration:none;font-weight:700;padding:12px 24px;border-radius:999px">Order now</a>
    </p>`;
  await send(to, `${productName} is back! 🎀`, shell("Back in stock", body));
}
