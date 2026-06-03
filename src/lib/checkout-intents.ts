import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendAbandonedCartEmail } from "@/lib/email";

type IntentItem = { name: string; quantity: number };

/**
 * Record (or refresh) a checkout intent for an email — the cart contents at the
 * moment the customer entered their email. Prior un-reminded/un-converted
 * intents for the same email are cleared so we keep just the latest.
 */
export async function recordIntent(
  email: string,
  items: IntentItem[],
  subtotalCents: number,
): Promise<void> {
  const supabase = createAdminClient();
  const normalized = email.trim().toLowerCase();
  await supabase
    .from("checkout_intents")
    .delete()
    .eq("email", normalized)
    .is("reminded_at", null)
    .is("converted_order_id", null);
  const { error } = await supabase.from("checkout_intents").insert({
    email: normalized,
    items,
    subtotal_cents: subtotalCents,
  });
  if (error) console.error("[abandoned-cart] record failed:", error.message);
}

/** Mark an email's open intent converted (called when an order is placed). */
export async function markConverted(email: string): Promise<void> {
  const supabase = createAdminClient();
  await supabase
    .from("checkout_intents")
    .update({ converted_order_id: null, reminded_at: new Date().toISOString() })
    .eq("email", email.trim().toLowerCase())
    .is("reminded_at", null);
  // Stamping reminded_at on conversion prevents a later reminder; we don't have
  // the order id here, so converted_order_id stays null but the intent is closed.
}

/**
 * Email customers who started checkout `afterHours` ago and haven't paid. Sends
 * one reminder per intent (stamps reminded_at). Best-effort.
 */
export async function sendAbandonedReminders(afterHours: number): Promise<number> {
  const supabase = createAdminClient();
  const cutoff = new Date(Date.now() - afterHours * 3_600_000).toISOString();
  const { data } = await supabase
    .from("checkout_intents")
    .select("id, email, items, created_at")
    .is("reminded_at", null)
    .is("converted_order_id", null)
    .lt("created_at", cutoff);
  const intents =
    (data as { id: string; email: string; items: IntentItem[]; created_at: string }[] | null) ??
    [];

  let sent = 0;
  for (const intent of intents) {
    // Skip if a paid order arrived for this email since the cart was started.
    const { count } = await supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("email", intent.email)
      .eq("payment_status", "paid")
      .gte("created_at", intent.created_at);
    if ((count ?? 0) > 0) {
      await supabase
        .from("checkout_intents")
        .update({ reminded_at: new Date().toISOString() })
        .eq("id", intent.id);
      continue;
    }
    await sendAbandonedCartEmail(intent.email, intent.items ?? []);
    await supabase
      .from("checkout_intents")
      .update({ reminded_at: new Date().toISOString() })
      .eq("id", intent.id);
    sent += 1;
  }
  return sent;
}
