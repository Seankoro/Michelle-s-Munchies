import "server-only";
import { newToken } from "@/lib/tokens";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendSubscriptionConfirmEmail } from "@/lib/email";

/**
 * Add or re-activate a newsletter subscriber by email, double-opt-in style.
 * Nothing is sent to the list address until it clicks the confirmation link,
 * so nobody can subscribe somebody else's inbox. Re-subscribing after an
 * unsubscribe also goes back through confirmation. Idempotent.
 */
export async function subscribeNewsletter(email: string): Promise<void> {
  const supabase = createAdminClient();
  const normalized = email.trim().toLowerCase();
  if (!normalized) return;
  const { data } = await supabase
    .from("newsletter_subscribers")
    .select("id, unsubscribed_at, confirmed_at")
    .eq("email", normalized)
    .maybeSingle();
  const existing = data as {
    id: string;
    unsubscribed_at: string | null;
    confirmed_at: string | null;
  } | null;

  if (existing && existing.confirmed_at && !existing.unsubscribed_at) return; // already active

  // A fresh token every time, never the one already on the row, so the link in
  // the newest email is the only one that works and older copies go dead.
  const confirmToken = newToken();
  if (existing) {
    await supabase
      .from("newsletter_subscribers")
      .update({ confirm_token: confirmToken })
      .eq("id", existing.id);
  } else {
    await supabase.from("newsletter_subscribers").insert({
      email: normalized,
      unsubscribe_token: newToken(),
      confirm_token: confirmToken,
    });
  }
  await sendSubscriptionConfirmEmail(normalized, { list: "newsletter" }, confirmToken);
}

/**
 * Confirm a newsletter subscription by its token. Clears any earlier
 * unsubscribe, since clicking the link is fresh consent. Returns whether the
 * token matched.
 *
 * The token is spent in the same update, so the link works once. Otherwise it
 * stays a permanent "put this address back on the list" URL, and an old email
 * being re-opened, forwarded, or fetched by a mail scanner would quietly undo
 * someone's unsubscribe. Someone who genuinely wants back on can subscribe
 * again, which mints a new token.
 */
export async function confirmNewsletterSubscription(token: string): Promise<boolean> {
  const supabase = createAdminClient();
  const now = new Date().toISOString();
  const { data } = await supabase
    .from("newsletter_subscribers")
    .update({ confirmed_at: now, consented_at: now, unsubscribed_at: null, confirm_token: null })
    .eq("confirm_token", token)
    .select("id")
    .maybeSingle();
  return Boolean(data);
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

/** How many contacts an admin send would reach right now. Confirmed only. */
export async function countActiveSubscribers(): Promise<number> {
  const supabase = createAdminClient();
  const { count } = await supabase
    .from("newsletter_subscribers")
    .select("id", { count: "exact", head: true })
    .is("unsubscribed_at", null)
    .not("confirmed_at", "is", null);
  return count ?? 0;
}

/** All still-subscribed, confirmed contacts, for an admin send. */
export async function listActiveSubscribers(): Promise<Subscriber[]> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("newsletter_subscribers")
    .select("email, unsubscribe_token")
    .is("unsubscribed_at", null)
    .not("confirmed_at", "is", null);
  return ((data as { email: string; unsubscribe_token: string }[] | null) ?? []).map((r) => ({
    email: r.email,
    unsubscribeToken: r.unsubscribe_token,
  }));
}
