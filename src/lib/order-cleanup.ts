import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendOrderCancelledEmail } from "@/lib/email";
import { singaporeDateString } from "@/lib/time";

/** Whole Singapore days an order must sit past its bake date before we touch it. */
const GRACE_DAYS = 3;

/** The order fields the sweep needs to judge a row and email its customer. */
type StaleOrderRow = {
  id: string;
  order_number: string;
  customer_name: string;
  email: string;
  tracking_token: string;
  created_at: string;
  updated_at: string;
};

/**
 * Cancel abandoned orders, so they stop holding a promo redemption and reserved
 * loyalty points forever.
 *
 * The bar is deliberately high, because the normal WhatsApp + PayNow flow leaves
 * a real order unpaid until Michelle reconciles her bank by hand, and the
 * paid-before-baking rule keeps those orders sitting in `received` the whole
 * time. An order is only abandoned if every one of these holds: still
 * `received`, so Michelle never even accepted it; still unpaid; no Stripe
 * PaymentIntent recorded against it, since that column means real money exists
 * for a human to reconcile; no deposit taken; no note written on it; never
 * rescheduled; nothing added to it; and its date came and went at least
 * GRACE_DAYS full days ago. Anything else means a human was involved, and a
 * human should decide.
 *
 * Unpaid orders never took stock or debited points, so there is nothing to
 * reverse, but the customer is emailed. A cancel nobody wanted is then visible
 * instead of the order silently disappearing on them.
 *
 * Returns the number of orders cancelled.
 */
export async function expireStaleUnpaidOrders(): Promise<number> {
  const admin = createAdminClient();
  // Singapore's calendar date GRACE_DAYS ago. A scheduled_date strictly before
  // it means that many whole Singapore days have finished since the order was
  // due. Singapore never shifts its clocks, so stepping back the same number of
  // 24-hour spans and reading the date in SGT lands on the right day at any hour.
  const cutoff = singaporeDateString(Date.now() - GRACE_DAYS * 24 * 60 * 60 * 1000);
  // Failed payments count as unpaid the same as pending ones, so an abandoned
  // order whose payment failed also frees its promo slot and held points.
  const { data, error } = await admin
    .from("orders")
    .select("id, order_number, customer_name, email, tracking_token, created_at, updated_at")
    .in("payment_status", ["pending", "failed"])
    .eq("status", "received")
    .lt("scheduled_date", cutoff)
    .or("deposit_cents.is.null,deposit_cents.eq.0")
    .is("owner_note", null)
    .eq("reschedule_count", 0)
    // A PaymentIntent on the row means real money exists against this order,
    // whether it was applied or the webhook only left it as a breadcrumb after
    // declining to apply it. Money is Michelle's to reconcile and refund, so the
    // sweep leaves those orders alone however stale they look.
    .is("stripe_payment_intent_id", null);
  if (error) throw new Error(`Failed to find stale orders: ${error.message}`);

  let cancelled = 0;
  for (const row of (data as StaleOrderRow[] | null) ?? []) {
    // Adding treats to an order and an admin reschedule both change the order
    // without leaving a flag of their own, so an updated_at still equal to
    // created_at is the one signal that catches them. It reads as "nobody has
    // touched this since checkout", which is what abandoned actually means.
    if (Date.parse(row.updated_at) !== Date.parse(row.created_at)) continue;

    // Re-check status and payment in the write itself. Michelle marking the
    // order confirmed or paid in the seconds since the read must win over a
    // cron run that already decided it was dead. A stray payment landing in that
    // window leaves its intent id behind without moving payment_status, so that
    // column is re-checked here too.
    const { data: claim, error: cancelError } = await admin
      .from("orders")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("id", row.id)
      .eq("status", "received")
      .in("payment_status", ["pending", "failed"])
      .is("stripe_payment_intent_id", null)
      .select("id")
      .maybeSingle();
    if (cancelError) throw new Error(`Failed to expire stale orders: ${cancelError.message}`);
    if (!claim) continue;
    cancelled += 1;

    // Best-effort, like every other cancel path, so a mail hiccup never leaves
    // the sweep looking failed when the order really was cancelled.
    try {
      await sendOrderCancelledEmail({
        orderNumber: row.order_number,
        trackingToken: row.tracking_token,
        name: row.customer_name,
        email: row.email,
        refunded: false,
      });
    } catch (emailError) {
      console.error("[expire] notification email failed:", emailError);
    }
  }
  return cancelled;
}
