import { formatPrice } from "@/lib/catalog";
import { formatLongDate, type AdminOrder } from "@/lib/order";
import { toWhatsAppDigits } from "@/lib/phone";

/**
 * One-tap ways for Michelle to reach a customer from the order screen. These
 * are pure string builders, kept out of the server-only whatsapp.ts so the
 * admin (a client component) can use them. The customer's phone is theirs, so
 * WhatsApp opens a chat to them, unlike the shop-facing link in whatsapp.ts.
 */

/** A wa.me link that opens a chat to the customer, or null if the number is not a valid SG mobile. */
export function customerWhatsAppUrl(phone: string, message?: string): string | null {
  const digits = toWhatsAppDigits(phone);
  if (!digits) return null;
  const query = message ? `?text=${encodeURIComponent(message)}` : "";
  return `https://wa.me/${digits}${query}`;
}

/** tel: link, digits and a leading plus only, so the dialer accepts it. */
export function telUrl(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

/** mailto: with the order number pre-filled in the subject. */
export function customerEmailUrl(order: AdminOrder): string {
  const subject = `Your Michelle's Munchies order ${order.orderNumber}`;
  return `mailto:${order.email}?subject=${encodeURIComponent(subject)}`;
}

/** Google Maps deep-link so a delivery address opens directions in one tap. */
export function mapsSearchUrl(query: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/**
 * A warm PayNow nudge for orders that are still unpaid. Michelle sends this,
 * then replies with the PayNow details in the same chat, matching what the
 * confirmation email tells customers to expect.
 */
export function paymentReminderMessage(order: AdminOrder): string {
  // Once a deposit is in, the money still owed is the balance, not the total.
  // Quoting the total asks for the deposit a second time and contradicts the
  // balance the panel shows right beside this button. Same sum as the panel,
  // and recordDeposit caps a deposit at the total, so it can't go negative.
  const depositCents = order.depositCents ?? 0;
  const balanceCents = order.totalCents - depositCents;
  return [
    `Hi ${order.name.split(" ")[0]}! This is Michelle's Munchies 🧁`,
    "",
    depositCents > 0
      ? `Just a gentle reminder about your order ${order.orderNumber}. Your ${formatPrice(depositCents)} deposit is in, so there's ${formatPrice(balanceCents)} left to go.`
      : `Just a gentle reminder about your order ${order.orderNumber} (${formatPrice(order.totalCents)}).`,
    `Whenever you're ready, I'll send you the PayNow details so I can lock in your bake for ${formatLongDate(order.scheduledDate)}.`,
    "",
    "Thank you so much!",
  ].join("\n");
}
