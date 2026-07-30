import "server-only";
import { newToken } from "@/lib/tokens";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Address-level suppression for the marketing email the cron sends: win-back
 * nudges, occasion reminders, birthday treats, and abandoned-cart prompts.
 *
 * These four had no opt-out at all, and the only unsubscribe that existed
 * governed the newsletter, so a customer who had explicitly left the list kept
 * hearing from the bakery. Singapore's Spam Control Act expects a working
 * unsubscribe on commercial email, and a customer who asks to stop should stop.
 *
 * Deliberately keyed on the email rather than a user id, because most buyers are
 * guests who never make an account, and it is the inbox that wants to be left
 * alone. Order updates are transactional and are never suppressed by this list:
 * someone who opted out of offers still needs to hear that their cake is ready.
 */

/** The opt-out token for an address, minting one the first time it is needed. */
export async function fetchOptOutToken(email: string): Promise<string | null> {
  const supabase = createAdminClient();
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;

  const { data } = await supabase
    .from("email_opt_outs")
    .select("token")
    .eq("email", normalized)
    .maybeSingle();
  const existing = (data as { token: string } | null)?.token;
  if (existing) return existing;

  // A row exists only once an address has a token, and an address that has
  // opted out already has one, so reaching here means minting a fresh token for
  // a footer link. created_at therefore means "token issued", not "opted out";
  // opted_out is the presence of the row plus a matched token at confirm time.
  const token = newToken();
  const { error } = await supabase
    .from("email_opt_outs")
    .insert({ email: normalized, token, opted_out_at: null });
  if (error) {
    // A concurrent send minted one first. Read it back rather than failing the
    // whole batch over a duplicate key.
    if (error.code === "23505") {
      const { data: raced } = await supabase
        .from("email_opt_outs")
        .select("token")
        .eq("email", normalized)
        .maybeSingle();
      return (raced as { token: string } | null)?.token ?? null;
    }
    console.error("[opt-out] could not issue a token:", error.message);
    return null;
  }
  return token;
}

/**
 * The subset of `emails` that has opted out. One query for a whole cron run,
 * because these jobs mail in loops and a per-recipient check would be a query
 * per customer.
 */
export async function fetchSuppressedEmails(emails: string[]): Promise<Set<string>> {
  const suppressed = new Set<string>();
  const normalized = emails.map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (normalized.length === 0) return suppressed;

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("email_opt_outs")
    .select("email")
    .in("email", normalized)
    .not("opted_out_at", "is", null);
  // Throw rather than treat a fault as "nobody opted out". Mailing someone who
  // asked us to stop is the failure this module exists to prevent, so a broken
  // check must stop the send, not wave it through.
  if (error) throw new Error(`Failed to read the opt-out list: ${error.message}`);

  for (const row of (data as { email: string }[] | null) ?? []) suppressed.add(row.email);
  return suppressed;
}

/** Record an opt-out from a footer link. Returns whether the token matched. */
export async function optOutByToken(token: string): Promise<boolean> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("email_opt_outs")
    .update({ opted_out_at: new Date().toISOString() })
    .eq("token", token)
    .select("email")
    .maybeSingle();
  return Boolean(data);
}
