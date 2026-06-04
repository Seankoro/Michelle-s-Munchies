import "server-only";
import { orderStatusLabels, type OrderStatus } from "@/lib/order";

/**
 * Twilio SMS and WhatsApp notifications.
 *
 * Mirrors the email module's contract. Best-effort, never throws, and a clean
 * no-op when credentials aren't configured, so notifications can be switched
 * on at launch with a paid Twilio account and zero code changes.
 *
 * We call Twilio's REST API directly with fetch to avoid a new dependency.
 * WhatsApp and SMS share one Messages endpoint. WhatsApp just prefixes the
 * to and from numbers with "whatsapp:". If TWILIO_WHATSAPP_FROM is set we use
 * WhatsApp, otherwise we fall back to SMS via TWILIO_FROM.
 */

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

function money(cents: number): string {
  return `S$${(cents / 100).toFixed(2)}`;
}

type TwilioConfig = {
  accountSid: string;
  authToken: string;
  from: string;
  /** When true, `from` and `to` are WhatsApp addresses prefixed with "whatsapp:". */
  whatsapp: boolean;
};

function getConfig(): TwilioConfig | null {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) return null;

  const whatsappFrom = process.env.TWILIO_WHATSAPP_FROM;
  if (whatsappFrom) {
    return { accountSid, authToken, from: whatsappFrom, whatsapp: true };
  }
  const smsFrom = process.env.TWILIO_FROM;
  if (smsFrom) {
    return { accountSid, authToken, from: smsFrom, whatsapp: false };
  }
  return null;
}

/** Normalise a raw phone into the channel address Twilio expects. */
function toAddress(phone: string, whatsapp: boolean): string {
  const trimmed = phone.trim();
  if (whatsapp) {
    return trimmed.startsWith("whatsapp:") ? trimmed : `whatsapp:${trimmed}`;
  }
  return trimmed;
}

async function sendMessage(toPhone: string, body: string): Promise<void> {
  const config = getConfig();
  if (!config) {
    console.warn(`[sms] Twilio not configured, skipping message to ${toPhone}`);
    return;
  }
  if (!toPhone.trim()) return;

  const url = `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Messages.json`;
  const params = new URLSearchParams({
    To: toAddress(toPhone, config.whatsapp),
    From: config.from,
    Body: body,
  });
  const auth = Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64");

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params,
    });
    if (!res.ok) {
      const detail = await res.text();
      console.error(`[sms] Twilio rejected message to ${toPhone} (${res.status}): ${detail}`);
    }
  } catch (error) {
    // Notifications must never break the order flow, log and move on.
    console.error(`[sms] Failed to send message to ${toPhone}:`, error);
  }
}

/** Alert Michelle the moment a new order lands. */
export async function notifyOwnerNewOrder(order: {
  orderNumber: string;
  name: string;
  totalCents: number;
  fulfillmentType: "pickup" | "delivery";
  isGift?: boolean;
}): Promise<void> {
  const owner = process.env.OWNER_NOTIFICATION_PHONE;
  if (!owner) return;
  const gift = order.isGift ? " 🎁 (gift)" : "";
  const body =
    `🎀 New order ${order.orderNumber}${gift}\n` +
    `${order.name} · ${order.fulfillmentType} · ${money(order.totalCents)}`;
  await sendMessage(owner, body);
}

// Only ping the customer at the moments that actually matter to them. This
// avoids texting on every internal status nudge.
const CUSTOMER_SMS_STATUSES: OrderStatus[] = ["ready", "out_for_delivery", "completed"];

/** Text the customer when their order reaches an actionable milestone. */
export async function notifyCustomerStatus(params: {
  phone: string;
  orderNumber: string;
  status: OrderStatus;
  trackingToken: string;
}): Promise<void> {
  if (!CUSTOMER_SMS_STATUSES.includes(params.status)) return;
  const label = orderStatusLabels[params.status];
  const body =
    `Michelle's Munchies: order ${params.orderNumber} is now ${label}. ` +
    `Track it: ${SITE_URL}/track/${params.trackingToken}`;
  await sendMessage(params.phone, body);
}
