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

/**
 * One-click opt-out line for the emails that are marketing rather than news
 * about a real order. Only those four carry it, because offering to unsubscribe
 * from an order confirmation would read as though we might stop baking. The
 * token is optional so callers that have no suppression token still compile,
 * and with none there is nothing to link to.
 */
/** The one-click opt-out URL for a marketing send, matching the footer link. */
function marketingOptOutUrl(optOutToken?: string): string | undefined {
  return optOutToken ? `${SITE_URL}/unsubscribe/marketing/${encodeURIComponent(optOutToken)}` : undefined;
}

function marketingFooter(optOutToken?: string): string {
  if (!optOutToken) return "";
  return `<p style="margin:24px 0 0;font-size:12px;color:#8b746d;text-align:center">
      Rather not get treat reminders?
      <a href="${SITE_URL}/unsubscribe/marketing/${escapeHtml(optOutToken)}" style="color:#8b746d">Unsubscribe</a>.
    </p>`;
}

/**
 * How long we wait on Resend before giving up on one email. The SDK sets no
 * timeout of its own, so without this a hung provider holds the caller open
 * until the platform kills the whole function.
 */
const SEND_TIMEOUT_MS = 8000;

/**
 * Resend's default allowance is 2 requests a second, and several jobs mail a
 * whole list back to back. Every send goes through one shared queue that leaves
 * a gap between calls, so a batch can never rate-limit itself into drops.
 */
const MIN_SEND_GAP_MS = 600;

let sendQueue: Promise<unknown> = Promise.resolve();
let lastSendAt = 0;

/** Runs `attempt` once the previous send has finished and the gap has passed. */
function queueSend<T>(attempt: () => Promise<T>): Promise<T> {
  const next = sendQueue.then(async () => {
    const wait = lastSendAt + MIN_SEND_GAP_MS - Date.now();
    if (wait > 0) await new Promise<void>((resolve) => setTimeout(resolve, wait));
    lastSendAt = Date.now();
    return attempt();
  });
  // Swallow the failure on the queue's copy only, so one bad send never wedges
  // every email behind it. The caller still sees the real outcome.
  sendQueue = next.catch(() => undefined);
  return next;
}

/** Rejects if `promise` hasn't settled in time, so no send can hang forever. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, expiry]).finally(() => clearTimeout(timer));
}

/**
 * Sends one email and reports whether it actually went out. Callers that stamp
 * "already sent" state must only do so when this returns true, or a rejected
 * send silently marks the recipient as mailed and they never hear from us.
 */
async function send(
  to: string,
  subject: string,
  html: string,
  /**
   * Absolute opt-out URL for a marketing send. When present, the mail carries
   * List-Unsubscribe so Gmail and Apple Mail show their own unsubscribe control
   * beside the sender, instead of leaving Report Spam as the easier tap. That
   * matters here because these go out from the same address as the order
   * confirmations, so a spam complaint costs delivery of mail people are
   * waiting for. Left off for transactional mail, which must not carry it.
   */
  optOutUrl?: string,
): Promise<boolean> {
  const resend = getResend();
  if (!resend) {
    console.warn(`[email] RESEND_API_KEY not set, skipping "${subject}" to ${to}`);
    return false;
  }
  try {
    const { error } = await queueSend(() =>
      withTimeout(
        resend.emails.send({
          from: FROM,
          to,
          subject,
          html,
          ...(optOutUrl
            ? {
                headers: {
                  "List-Unsubscribe": `<${optOutUrl}>`,
                  "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
                },
              }
            : {}),
        }),
        SEND_TIMEOUT_MS,
        `Resend send of "${subject}"`,
      ),
    );
    if (error) {
      console.error(`[email] Resend rejected "${subject}" to ${to}:`, error);
      Sentry.captureMessage(`Resend rejected "${subject}"`, {
        level: "error",
        extra: { to, error },
      });
      return false;
    }
    return true;
  } catch (error) {
    // Email must never break the order flow. Log, report, and move on so the
    // customer's order still succeeds while Michelle finds out something broke.
    console.error(`[email] Failed to send "${subject}" to ${to}:`, error);
    Sentry.captureException(error, { extra: { subject, to } });
    return false;
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
    ${
      // Deliberately NOT the buyer's own gift message. This email goes to
      // whatever address the order carried, and placing an order needs no
      // account and no payment, so echoing the sender's own prose back to an
      // unverified inbox turns checkout into a way to mail a stranger from our
      // sending domain. The buyer wrote the message and does not need it read
      // back; Michelle gets it in her copy below, in the panel, and on the
      // packing slip, which is where it is actually used.
      order.isGift ? `<p style="margin:8px 0">🎁 Sent as a gift.</p>` : ""
    }
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
}): Promise<boolean> {
  const label = orderStatusLabels[params.status];
  const line = statusLines[params.status] ?? "here&rsquo;s an update on your order.";
  const body = `
    <p>Hi ${escapeHtml(params.name.split(" ")[0])}, ${line}</p>
    <p style="margin:8px 0"><strong>Order ${params.orderNumber}</strong> is now
      <strong style="color:#bc4a6a">${label}</strong>.</p>`;
  return send(params.email, `${label} · ${params.orderNumber}`, shell("Order update", body, params.trackingToken));
}

/** Customer notification when an order is cancelled, with the refund status. */
export async function sendOrderCancelledEmail(params: {
  orderNumber: string;
  trackingToken: string;
  name: string;
  email: string;
  refunded: boolean;
}): Promise<boolean> {
  const refundLine = params.refunded
    ? `<p style="margin:8px 0">Your payment has been refunded. It should appear back on your card within a few business days.</p>`
    : `<p style="margin:8px 0">If you had already paid, we&rsquo;ll be in touch about the refund. Reply here or message us on WhatsApp any time.</p>`;
  const body = `
    <p>Hi ${escapeHtml(params.name.split(" ")[0])}, your order has been cancelled.</p>
    <p style="margin:8px 0"><strong>Order ${params.orderNumber}</strong> is now
      <strong style="color:#bc4a6a">cancelled</strong>.</p>
    ${refundLine}`;
  return send(
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
}): Promise<boolean> {
  const when = `${formatLongDate(params.scheduledDate)}${params.timeWindow ? ` · ${escapeHtml(params.timeWindow)}` : ""}`;
  const body = `
    <p>Hi ${escapeHtml(params.name.split(" ")[0])}, heads up: we&rsquo;ve moved your order to a new date.</p>
    <p style="margin:8px 0"><strong>Order ${params.orderNumber}</strong> is now set for
      <strong style="color:#bc4a6a">${when}</strong>.</p>
    <p style="margin:8px 0;font-size:13px;color:#8b746d">If this doesn&rsquo;t work for you, just reply or reach out on WhatsApp and we&rsquo;ll sort it out.</p>`;
  return send(params.email, `New date confirmed · ${params.orderNumber}`, shell("Order rescheduled", body, params.trackingToken));
}

/**
 * Owner alert when the customer moves their own bake date from the tracking
 * page. Every other self-serve change already mails her, and this one did not,
 * so she could be shopping for a Saturday the order has already left. Both
 * slots are shown because nothing in the order records the old date afterwards.
 */
export async function sendCustomerRescheduledEmail(params: {
  orderNumber: string;
  customerName: string;
  fromDate: string;
  fromWindow: string;
  toDate: string;
  toWindow: string;
  trackingToken: string;
}): Promise<boolean> {
  const owner = process.env.OWNER_NOTIFICATION_EMAIL;
  if (!owner) return false;
  const was = `${formatLongDate(params.fromDate)}${params.fromWindow ? ` · ${escapeHtml(params.fromWindow)}` : ""}`;
  const now = `${formatLongDate(params.toDate)}${params.toWindow ? ` · ${escapeHtml(params.toWindow)}` : ""}`;
  const body = `
    <p><strong>${escapeHtml(params.customerName)}</strong> moved order
      <strong>${escapeHtml(params.orderNumber)}</strong> to a different slot themselves.</p>
    <p style="margin:8px 0"><strong>Was:</strong> ${was}<br/>
      <strong>Now:</strong> ${now}</p>
    <p style="margin:8px 0">Check your bake list for both days in case you had already planned or shopped for the old one.</p>
    <p style="margin:24px 0 0;text-align:center">
      <a href="${SITE_URL}/track/${escapeHtml(params.trackingToken)}" style="display:inline-block;background:#bc4a6a;color:#fff;text-decoration:none;font-weight:700;padding:12px 24px;border-radius:999px">See the order</a>
    </p>`;
  return send(
    owner,
    `Date moved by customer: ${params.orderNumber}`,
    shell("Customer moved their date", body),
  );
}

/** After a completed order, invite the buyer to review the treats they bought. */
export async function sendReviewRequestEmail(params: {
  to: string;
  name: string;
  orderNumber: string;
  products: { name: string; slug: string }[];
}): Promise<boolean> {
  if (params.products.length === 0) return false;
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
  return send(params.to, "How were your treats? 🎀", shell("Leave a review", body));
}

/** Tell the owner a customer added items to an existing order. */
export async function sendItemsAddedEmail(
  orderNumber: string,
  customerName: string,
  addedItems: string[],
): Promise<boolean> {
  const owner = process.env.OWNER_NOTIFICATION_EMAIL;
  if (!owner || addedItems.length === 0) return false;
  const list = addedItems
    .map((line) => `<li style="padding:2px 0">${escapeHtml(line)}</li>`)
    .join("");
  const body = `
    <p><strong>${escapeHtml(customerName)}</strong> added items to order ${orderNumber}:</p>
    <ul style="margin:8px 0;padding-left:18px">${list}</ul>
    <p style="font-size:13px;color:#8b746d">The order total was updated. Same date and delivery.</p>`;
  return send(owner, `Items added to ${orderNumber}`, shell("Order updated", body));
}

/** Tell the owner a gift recipient has filled in their delivery details. */
export async function sendGiftScheduledEmail(
  orderNumber: string,
  recipientName: string | null,
  address: { line1: string; unit?: string; postalCode: string },
  timeWindow: string,
): Promise<boolean> {
  const owner = process.env.OWNER_NOTIFICATION_EMAIL;
  if (!owner) return false;
  const who = recipientName?.trim() ? escapeHtml(recipientName.trim()) : "The recipient";
  const line = `${escapeHtml(address.line1)}${address.unit ? `, ${escapeHtml(address.unit)}` : ""}, Singapore ${escapeHtml(address.postalCode)}`;
  const body = `
    <p><strong>${who}</strong> confirmed delivery details for gift order ${orderNumber}:</p>
    <p style="margin:8px 0"><strong>When:</strong> ${escapeHtml(timeWindow)}</p>
    <p style="margin:8px 0"><strong>Where:</strong> ${line}</p>`;
  return send(owner, `Gift ${orderNumber} scheduled`, shell("Gift details confirmed", body));
}

/**
 * Nudge the gift buyer when the recipient still hasn't filled in an address or
 * time window and the bake date is close. The buyer is the only person who
 * knows the recipient, so they are the only one who can chase them, and the
 * same link lets them fill it in themselves if they already know the details.
 */
export async function sendGiftScheduleReminderEmail(params: {
  to: string;
  buyerName: string;
  recipientName: string | null;
  orderNumber: string;
  scheduledDate: string;
  recipientToken: string;
}): Promise<boolean> {
  const who = params.recipientName?.trim()
    ? escapeHtml(params.recipientName.trim())
    : "Your recipient";
  const url = `${SITE_URL}/gift/${escapeHtml(params.recipientToken)}`;
  const body = `
    <p>Hi ${escapeHtml(params.buyerName.split(" ")[0])}, gift order
      <strong>${escapeHtml(params.orderNumber)}</strong> is set for
      <strong style="color:#bc4a6a">${formatLongDate(params.scheduledDate)}</strong>, and we still
      don&rsquo;t have a delivery address or time window for it.</p>
    <p style="margin:8px 0">${who} hasn&rsquo;t filled theirs in yet. Pass on the link below to nudge them, or fill it in yourself if you already know where the box should go.</p>
    <p style="margin:24px 0 0;text-align:center">
      <a href="${url}" style="display:inline-block;background:#bc4a6a;color:#fff;text-decoration:none;font-weight:700;padding:12px 24px;border-radius:999px">Add the delivery details</a>
    </p>`;
  return send(
    params.to,
    `Order ${params.orderNumber}: your gift still needs delivery details`,
    shell("Your gift needs details", body),
  );
}

/** Warm nudge for a customer who hasn't ordered in a while. */
export async function sendWinbackEmail(
  to: string,
  name: string,
  optOutToken?: string,
): Promise<boolean> {
  const first = (name || "there").split(" ")[0];
  const body = `
    <p>Hi ${escapeHtml(first)}, it&rsquo;s been a while! Michelle has been baking up a storm and we&rsquo;d love to treat you again.</p>
    <p style="margin:24px 0 0;text-align:center">
      <a href="${SITE_URL}/menu" style="display:inline-block;background:#bc4a6a;color:#fff;text-decoration:none;font-weight:700;padding:12px 24px;border-radius:999px">See what&rsquo;s fresh</a>
    </p>
    ${marketingFooter(optOutToken)}`;
  return send(to, "We miss you at Michelle's Munchies 🎀", shell("Come back for a treat", body), marketingOptOutUrl(optOutToken));
}

/** Reminder that a saved occasion is coming up, with a nudge to reorder in time. */
export async function sendOccasionReminderEmail(
  to: string,
  name: string,
  label: string,
  daysBefore: number,
  optOutToken?: string,
): Promise<boolean> {
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
    </p>
    ${marketingFooter(optOutToken)}`;
  return send(to, `${label} is coming up 🎀`, shell("A treat-worthy date is near", body), marketingOptOutUrl(optOutToken));
}

/** Gentle nudge for a cart that was started but not checked out. */
export async function sendAbandonedCartEmail(
  to: string,
  items: { name: string; quantity: number }[],
  optOutToken?: string,
): Promise<boolean> {
  const list = items
    .map((i) => `<li style="padding:2px 0">${i.quantity}× ${escapeHtml(i.name)}</li>`)
    .join("");
  const body = `
    <p>You left some treats in your cart. They&rsquo;re still waiting for you! 🎀</p>
    <ul style="margin:8px 0;padding-left:18px">${list}</ul>
    <p style="margin:24px 0 0;text-align:center">
      <a href="${SITE_URL}/cart" style="display:inline-block;background:#bc4a6a;color:#fff;text-decoration:none;font-weight:700;padding:12px 24px;border-radius:999px">Finish your order</a>
    </p>
    ${marketingFooter(optOutToken)}`;
  return send(to, "Still thinking it over? 🎀", shell("Your cart is waiting", body), marketingOptOutUrl(optOutToken));
}

/** Send one newsletter email with an unsubscribe link in the footer. */
export async function sendNewsletterEmail(
  to: string,
  subject: string,
  bodyHtml: string,
  unsubscribeToken: string,
): Promise<boolean> {
  const unsubUrl = `${SITE_URL}/unsubscribe?token=${unsubscribeToken}`;
  const body = `${bodyHtml}
    <p style="margin:24px 0 0;font-size:12px;color:#8b746d;text-align:center">
      You're getting this because you signed up at Michelle's Munchies.
      <a href="${unsubUrl}" style="color:#8b746d">Unsubscribe</a>.
    </p>`;
  return send(to, subject, shell(subject, body), `${SITE_URL}/unsubscribe?token=${encodeURIComponent(unsubscribeToken)}`);
}

/** Owner alert, a customer has asked to cancel an order. */
export async function sendCancellationRequestEmail(
  orderNumber: string,
  customerName: string,
): Promise<boolean> {
  const owner = process.env.OWNER_NOTIFICATION_EMAIL;
  if (!owner) return false;
  const body = `
    <p><strong>${escapeHtml(customerName)}</strong> has asked to cancel order
      <strong>${escapeHtml(orderNumber)}</strong>.</p>
    <p style="margin:8px 0">Review it in Admin and cancel plus refund if you are happy to.</p>`;
  return send(owner, `Cancellation request: ${orderNumber}`, shell("Cancellation request", body));
}

/** Owner alert when a tracked product runs low on stock. */
export async function sendLowStockEmail(
  to: string,
  productName: string,
  remaining: number,
): Promise<boolean> {
  const body = `
    <p><strong>${escapeHtml(productName)}</strong> is running low.</p>
    <p style="margin:8px 0">${remaining === 0 ? "It just sold out and is now hidden from the menu." : `Only ${remaining} left in stock.`}</p>
    <p style="margin:8px 0">Top up the count in Admin when you bake more.</p>`;
  return send(to, `Low stock: ${productName}`, shell("Low stock alert", body));
}

/** Birthday greeting + reward-points note. */
export async function sendBirthdayEmail(
  to: string,
  points: number,
  optOutToken?: string,
): Promise<boolean> {
  const body = `
    <p>Happy birthday from Michelle&rsquo;s Munchies! 🎂</p>
    <p style="margin:8px 0">We&rsquo;ve popped <strong>${points} reward points</strong> into your
      account as a little treat. Enjoy something sweet on us.</p>
    <p style="margin:24px 0 0;text-align:center">
      <a href="${SITE_URL}/menu" style="display:inline-block;background:#bc4a6a;color:#fff;text-decoration:none;font-weight:700;padding:12px 24px;border-radius:999px">Treat yourself</a>
    </p>
    ${marketingFooter(optOutToken)}`;
  return send(to, "Happy birthday! 🎂 A treat from us", shell("Happy birthday!", body), marketingOptOutUrl(optOutToken));
}

/** "It's back!" email when a previously sold-out product is available again. */
export async function sendBackInStockEmail(
  to: string,
  productName: string,
  slug: string,
): Promise<boolean> {
  const url = `${SITE_URL}/menu/${slug}`;
  const body = `
    <p>Good news! <strong>${escapeHtml(productName)}</strong> is back in stock.</p>
    <p style="margin:8px 0">Pop back in to order before it sells out again.</p>
    <p style="margin:24px 0 0;text-align:center">
      <a href="${url}" style="display:inline-block;background:#bc4a6a;color:#fff;text-decoration:none;font-weight:700;padding:12px 24px;border-radius:999px">Order now</a>
    </p>`;
  return send(to, `${productName} is back! 🎀`, shell("Back in stock", body));
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
): Promise<boolean> {
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
  return send(to, "Please confirm your email 🎀", shell("One quick tap", body));
}

/**
 * Owner alert for a Stripe payment we could not apply to its order, either
 * because the amounts disagree or because no order matched. The money is real
 * and sitting in Stripe, so Michelle needs the numbers in front of her to
 * reconcile or refund by hand. `orderTotalCents` is null when no order matched.
 */
export async function sendPaymentReviewEmail(params: {
  orderNumber: string;
  sessionId: string;
  amountPaidCents: number | null;
  orderTotalCents: number | null;
}): Promise<boolean> {
  const owner = process.env.OWNER_NOTIFICATION_EMAIL;
  if (!owner) return false;
  const reason =
    params.orderTotalCents == null
      ? "we could not find an order with that number"
      : "the amount paid does not match the order total";
  const body = `
    <p>A Stripe payment came in for order <strong>${escapeHtml(params.orderNumber)}</strong> but
      ${reason}, so the order has been left unpaid.</p>
    <p style="margin:8px 0"><strong>Paid:</strong> ${params.amountPaidCents == null ? "unknown" : formatPrice(params.amountPaidCents)}<br/>
      <strong>Order total:</strong> ${params.orderTotalCents == null ? "no order found" : formatPrice(params.orderTotalCents)}<br/>
      <strong>Stripe session:</strong> ${escapeHtml(params.sessionId)}</p>
    <p style="margin:8px 0">The customer has been charged. Find the payment in Stripe, then either
      refund it or settle the difference and mark the order paid by hand.</p>`;
  return send(
    owner,
    `Payment needs review: ${params.orderNumber}`,
    shell("Payment needs review", body),
  );
}
