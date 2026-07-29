import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { markOrderPaid } from "@/lib/admin-db";
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

    // The session was priced at the order's total when checkout started, but
    // the order can legally grow before payment, through the add-items flow or
    // a gift recipient scheduling a delivery fee. Paying that stale session
    // must not mark the enlarged order paid, or the difference gets baked for
    // free. On a mismatch the order stays unpaid and Michelle reconciles the
    // Stripe payment by hand, which is the safe side of the error.
    const admin = createAdminClient();
    const { data } = await admin
      .from("orders")
      .select("total_cents")
      .eq("order_number", orderNumber)
      .maybeSingle();
    const totalCents = (data as { total_cents: number } | null)?.total_cents;
    if (totalCents == null) return;
    if (session.amount_total != null && session.amount_total !== totalCents) {
      console.error(
        `[stripe-webhook] amount mismatch on ${orderNumber}: session paid ${session.amount_total}, order total ${totalCents}. Left unpaid for manual review.`,
      );
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
  } catch {
    // Returning 500 tells Stripe to retry the webhook later.
    return new Response("Failed to process event.", { status: 500 });
  }

  return new Response("ok", { status: 200 });
}
