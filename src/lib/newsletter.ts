import "server-only";
import { randomBytes } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

/** Add or re-activate a newsletter subscriber by email. Idempotent. */
export async function subscribeNewsletter(email: string): Promise<void> {
  const supabase = createAdminClient();
  const normalized = email.trim().toLowerCase();
  if (!normalized) return;
  const { data } = await supabase
    .from("newsletter_subscribers")
    .select("id, unsubscribed_at")
    .eq("email", normalized)
    .maybeSingle();
  const existing = data as { id: string; unsubscribed_at: string | null } | null;
  if (existing) {
    if (existing.unsubscribed_at) {
      await supabase
        .from("newsletter_subscribers")
        .update({ unsubscribed_at: null, consented_at: new Date().toISOString() })
        .eq("id", existing.id);
    }
    return;
  }
  await supabase
    .from("newsletter_subscribers")
    .insert({ email: normalized, unsubscribe_token: randomBytes(16).toString("hex") });
}

/** Mark a subscriber unsubscribed by their token. Returns whether it matched. */
export async function unsubscribeByToken(token: string): Promise<boolean> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("newsletter_subscribers")
    .update({ unsubscribed_at: new Date().toISOString() })
    .eq("unsubscribe_token", token)
    .select("id")
    .maybeSingle();
  return Boolean(data);
}

export type Subscriber = { email: string; unsubscribeToken: string };

/** All still-subscribed contacts, for an admin send. */
export async function listActiveSubscribers(): Promise<Subscriber[]> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("newsletter_subscribers")
    .select("email, unsubscribe_token")
    .is("unsubscribed_at", null);
  return ((data as { email: string; unsubscribe_token: string }[] | null) ?? []).map((r) => ({
    email: r.email,
    unsubscribeToken: r.unsubscribe_token,
  }));
}
