import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchOptOutToken, fetchSuppressedEmails } from "@/lib/email-optout";
import { sendWinbackEmail } from "@/lib/email";

/** Days since a customer's last order before one win-back nudge is sent. */
const WINBACK_AFTER_DAYS = 45;
/** Cap per run so a first pass over a long list can't fan out unbounded email. */
const MAX_PER_RUN = 50;

type OrderRow = {
  user_id: string;
  email: string;
  customer_name: string;
  created_at: string;
  payment_status: string;
};

/**
 * Emails a warm win-back to signed-in customers who have a past paid order but
 * haven't placed anything in WINBACK_AFTER_DAYS. The send is stamped on the
 * profile so each lapse is nudged at most once; a customer who returns and then
 * lapses again becomes eligible for a fresh nudge. Returns how many were sent.
 */
export async function sendWinbackNudges(): Promise<number> {
  const admin = createAdminClient();
  const cutoff = new Date(Date.now() - WINBACK_AFTER_DAYS * 24 * 60 * 60 * 1000);

  const { data: orderRows } = await admin
    .from("orders")
    .select("user_id, email, customer_name, created_at, payment_status")
    .not("user_id", "is", null)
    .order("created_at", { ascending: false });
  const orders = (orderRows as OrderRow[] | null) ?? [];

  // Collapse to one record per customer: their most recent order (rows arrive
  // newest first) plus whether they have ever paid.
  const byUser = new Map<
    string,
    { email: string; name: string; lastOrder: Date; hasPaid: boolean }
  >();
  for (const order of orders) {
    const existing = byUser.get(order.user_id);
    if (!existing) {
      byUser.set(order.user_id, {
        email: order.email,
        name: order.customer_name,
        lastOrder: new Date(order.created_at),
        hasPaid: order.payment_status === "paid",
      });
    } else if (order.payment_status === "paid") {
      existing.hasPaid = true;
    }
  }

  const lapsedIds = [...byUser.entries()]
    .filter(([, u]) => u.hasPaid && u.lastOrder < cutoff)
    .map(([id]) => id);
  if (lapsedIds.length === 0) return 0;

  const { data: profileRows } = await admin
    .from("profiles")
    .select("id, winback_sent_at")
    .in("id", lapsedIds);
  const nudgedAt = new Map(
    ((profileRows as { id: string; winback_sent_at: string | null }[] | null) ?? []).map((p) => [
      p.id,
      p.winback_sent_at ? new Date(p.winback_sent_at) : null,
    ]),
  );

  // This is marketing, so anyone who asked to stop hearing from us is skipped.
  // One query for the run rather than a check per customer.
  const suppressed = await fetchSuppressedEmails(lapsedIds.map((id) => byUser.get(id)!.email));

  let sent = 0;
  for (const id of lapsedIds) {
    if (sent >= MAX_PER_RUN) break;
    const user = byUser.get(id)!;
    const stamp = nudgedAt.get(id);
    // Skip if this lapse was already nudged (stamp is after their last order).
    if (stamp && stamp >= user.lastOrder) continue;
    if (suppressed.has(user.email.trim().toLowerCase())) continue;

    // Stamp before sending so a failed send is not retried into spam.
    await admin
      .from("profiles")
      .update({ winback_sent_at: new Date().toISOString() })
      .eq("id", id);
    // The footer link is what makes this a lawful marketing send, so a missing
    // token means we do not send at all rather than mail without an opt-out.
    const optOutToken = await fetchOptOutToken(user.email);
    if (!optOutToken) continue;
    await sendWinbackEmail(user.email, user.name, optOutToken);
    sent += 1;
  }
  return sent;
}
