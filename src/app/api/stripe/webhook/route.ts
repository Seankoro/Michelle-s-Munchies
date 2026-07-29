import type Stripe from "stripe";
import * as Sentry from "@sentry/nextjs";
import { getStripe } from "@/lib/stripe";
import { markOrderPaid } from "@/lib/admin-db";
import { sendPaymentReviewEmail } from "@/lib/email";
import { createAdminClient } from "@/lib/supabase/admin";

// Stripe's SDK needs the Node runtime, not edge, and the raw request body.
export const runtime = "nodejs";

export async function POST(request: Request) {
  const stripe = getStripe();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !webhookSecret) {
    return new Response("Stripe is not configured.", { status: 400 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) return new Response("Missing signature.", { status: 400 });

  const body = await request.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch {
    // Signature didn't verify, reject it since it could be a forged request.
    return new Response("Invalid signature.", { status: 400 });
  }

  async function paidFromSession(session: Stripe.Checkout.Session) {
    const orderNumber = session.metadata?.order_number;
    if (!orderNumber) return;
    const paymentIntentId =
      typeof session.payment_intent === "string" ? session.payment_intent : null;

    const admin = createAdminClient();
    const { data, error } = await admin
      .from("orders")
      .select("total_cents")
      .eq("order_number", orderNumber)
      .maybeSingle();
    // A failed read is not "nothing to do". Throwing sends Stripe a 500 so it
    // retries the event, instead of a database blip silently swallowing a real
    // payment that Stripe would then never deliver again.
    if (error) throw new Error(`Could not load order ${orderNumber}: ${error.message}`);
    const totalCents = (data as { total_cents: number } | null)?.total_cents;

    // The session was priced at the order's total when checkout started, but
    // the order can legally grow before payment, through the add-items flow or
    // a gift recipient scheduling a delivery fee. Paying that stale session
    // must not mark the enlarged order paid, or the difference gets baked for
    // free. On a mismatch the order stays unpaid and Michelle reconciles the
    // Stripe payment by hand, which is the safe side of the error. She can only
    // do that if she hears about it, so both bail-outs alert rather than log.
    const mismatch =
      totalCents != null && session.amount_total != null && session.amount_total !== totalCents;
    if (totalCents == null || mismatch) {
      const detail = {
        orderNumber,
        sessionId: session.id,
        amountTotal: session.amount_total,
        totalCents: totalCents ?? null,
      };
      // Record the PaymentIntent even though the order stays unpaid, the same
      // backfill markOrderPaid does, so the stray payment has a handle on the
      // row for a refund. Nothing reads this as proof the order was paid.
      if (paymentIntentId) {
        await admin
          .from("orders")
          .update({ stripe_payment_intent_id: paymentIntentId })
          .eq("order_number", orderNumber)
          .is("stripe_payment_intent_id", null);
      }
      console.error(
        `[stripe-webhook] payment left unapplied on ${orderNumber}: session paid ${session.amount_total}, order total ${totalCents ?? "not found"}. Left unpaid for manual review.`,
      );
      Sentry.captureMessage("Stripe payment could not be applied to its order", {
        level: "error",
        extra: detail,
      });
      await sendPaymentReviewEmail({
        orderNumber,
        sessionId: session.id,
        amountPaidCents: session.amount_total,
        orderTotalCents: totalCents ?? null,
      });
      return;
    }

    await markOrderPaid(orderNumber, paymentIntentId);
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        // Cards confirm immediately as "paid". PayNow may still be processing
        // and will arrive via async_payment_succeeded below.
        if (session.payment_status === "paid") await paidFromSession(session);
        break;
      }
      case "checkout.session.async_payment_succeeded": {
        await paidFromSession(event.data.object as Stripe.Checkout.Session);
        break;
      }
      default:
        break;
    }
  } catch (error) {
    // Returning 500 tells Stripe to retry the webhook later. Report it too, or
    // a payment that keeps failing to apply is only ever a serverless log line.
    console.error(`[stripe-webhook] failed to process ${event.type}:`, error);
    Sentry.captureException(error, { extra: { eventType: event.type, eventId: event.id } });
    return new Response("Failed to process event.", { status: 500 });
  }

  return new Response("ok", { status: 200 });
}
