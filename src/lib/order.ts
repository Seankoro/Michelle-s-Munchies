import type { CartItem } from "@/lib/types";

export type FulfillmentType = "pickup" | "delivery";

export type DeliveryAddress = {
  line1: string;
  unit?: string;
  postalCode: string;
};

/** The base shape of a placed order, extended by AdminOrder below. */
type PlacedOrder = {
  orderNumber: string;
  items: CartItem[];
  fulfillmentType: FulfillmentType;
  scheduledDate: string; // yyyy-mm-dd
  timeWindow: string;
  address?: DeliveryAddress;
  name: string;
  email: string;
  phone: string;
  notes?: string;
  isGift?: boolean;
  giftMessage?: string;
  recipientName?: string;
  recipientPhone?: string;
  subtotalCents: number;
  deliveryFeeCents: number;
  totalCents: number;
  createdAt: string; // ISO timestamp
};

type FeeSettings = {
  deliveryFeeCents: number;
  freeDeliveryMinCents: number | null;
};

/** Pickup is always free. Delivery is a flat fee, waived above the threshold. */
export function computeDeliveryFeeCents(
  subtotalCents: number,
  fulfillment: FulfillmentType,
  settings: FeeSettings,
): number {
  if (fulfillment === "pickup") return 0;
  if (
    settings.freeDeliveryMinCents != null &&
    settings.freeDeliveryMinCents > 0 &&
    subtotalCents >= settings.freeDeliveryMinCents
  ) {
    return 0;
  }
  return settings.deliveryFeeCents;
}

const BASE36_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/**
 * A cryptographically random base-36 string. The order number acts as a light
 * second factor next to the customer's email in guest order lookup, so the
 * suffix must not be guessable the way Math.random output is. Uses Web Crypto,
 * which exists in both Node and the browser, since this module is shared.
 * Rejection-samples each byte so no character is favoured by modulo bias.
 */
function randomBase36(length: number): string {
  let out = "";
  const limit = 252; // largest multiple of 36 below 256
  while (out.length < length) {
    const bytes = new Uint8Array(length * 2);
    globalThis.crypto.getRandomValues(bytes);
    for (const byte of bytes) {
      if (byte < limit) out += BASE36_ALPHABET[byte % 36];
      if (out.length === length) break;
    }
  }
  return out;
}

/**
 * Human-friendly order number, e.g. "MM-260602-7K3QP9WL". The 8-char suffix
 * (36^8, ~2.8 trillion combinations) makes a same-day collision with another
 * order astronomically unlikely; createOrder still retries a collision anyway.
 */
export function generateOrderNumber(date = new Date()): string {
  const yy = String(date.getFullYear()).slice(-2);
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const random = randomBase36(8);
  return `MM-${yy}${mm}${dd}-${random}`;
}

/** Local date as yyyy-mm-dd, avoiding the UTC off-by-one from toISOString. */
export function toISODate(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Earliest date a customer may choose, given the lead time in days. If a
 * same-day `cutoffTime` in "HH:MM" form is set and the current local time is
 * past it, the earliest date moves one extra day later.
 */
export function earliestFulfillmentDate(
  leadTimeDays: number,
  today = new Date(),
  cutoffTime?: string | null,
): string {
  const date = new Date(today);
  date.setDate(date.getDate() + leadTimeDays);
  if (cutoffTime && isPastCutoff(today, cutoffTime)) {
    date.setDate(date.getDate() + 1);
  }
  return toISODate(date);
}

/** True if `now`'s local time is at or after the "HH:MM" cutoff. */
function isPastCutoff(now: Date, cutoffTime: string): boolean {
  const [h, m] = cutoffTime.split(":").map(Number);
  if (!Number.isFinite(h)) return false;
  const cutoff = new Date(now);
  cutoff.setHours(h, m || 0, 0, 0);
  return now.getTime() >= cutoff.getTime();
}

/** Friendly date for display, e.g. "Thu, 4 Jun 2026". */
export function formatLongDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString("en-SG", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// ---------------------------------------------------------------------------
// Order lifecycle, managed in admin
// ---------------------------------------------------------------------------
export type OrderStatus =
  | "received"
  | "confirmed"
  | "baking"
  | "ready"
  | "out_for_delivery"
  | "completed"
  | "cancelled";

export type PaymentStatus = "pending" | "paid" | "refunded" | "failed";

export const ORDER_STATUSES: OrderStatus[] = [
  "received",
  "confirmed",
  "baking",
  "ready",
  "out_for_delivery",
  "completed",
  "cancelled",
];

export const orderStatusLabels: Record<OrderStatus, string> = {
  received: "Received",
  confirmed: "Confirmed",
  baking: "Baking",
  ready: "Ready",
  out_for_delivery: "Out for delivery",
  completed: "Completed",
  cancelled: "Cancelled",
};

/**
 * Statuses early enough for a customer to still change the order (reschedule,
 * add items, cancel). One source of truth so the self-serve panels can't drift.
 */
export const EARLY_STATUSES: OrderStatus[] = ["received", "confirmed"];
export const isChangeable = (status: OrderStatus | string): boolean =>
  EARLY_STATUSES.includes(status as OrderStatus);

/**
 * Fulfilment statuses that mean real work has started, so an order may only be
 * moved into them once it is paid. `received` and `confirmed` are the pre-work
 * window, and `cancelled` is always allowed, so none of those are gated.
 */
export const STATUSES_REQUIRING_PAYMENT: OrderStatus[] = [
  "baking",
  "ready",
  "out_for_delivery",
  "completed",
];
export const statusRequiresPayment = (status: OrderStatus): boolean =>
  STATUSES_REQUIRING_PAYMENT.includes(status);

/** Rank a time window by the owner's configured order, unknowns sorting last. */
export const windowRank = (timeWindows: string[], w: string | null): number => {
  const i = timeWindows.indexOf(w ?? "");
  return i === -1 ? timeWindows.length : i;
};

export const paymentStatusLabels: Record<PaymentStatus, string> = {
  pending: "Payment pending",
  paid: "Paid",
  refunded: "Refunded",
  failed: "Payment failed",
};

/** An order as Michelle sees it in the admin, with lifecycle and payment state. */
export type AdminOrder = PlacedOrder & {
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  /** Michelle's private note to herself, never shown to the customer. */
  ownerNote?: string;
  /** Deposit already collected. 0/null means none; balance = total - deposit. */
  depositCents?: number | null;
};
