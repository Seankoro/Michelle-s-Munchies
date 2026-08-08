import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchOptOutToken, fetchSuppressedEmails } from "@/lib/email-optout";
import { sendOccasionReminderEmail } from "@/lib/email";
import { singaporeDateString } from "@/lib/time";

/** Cap per run so a first pass over a long list can't fan out unbounded email. */
const MAX_PER_RUN = 100;
/**
 * And a cap per person inside that, because the global one alone is a shared
 * pool anyone can drain. Nothing stops a signed-up customer saving occasions,
 * and each due one is an email the bakery pays to send, so a single account
 * with enough rows could take the whole hourly budget and use the bakery's own
 * sending reputation to do it. Two is more than any real person needs on one
 * day, and it also means one account can never crowd everyone else out of the
 * run.
 */
const MAX_PER_USER_PER_RUN = 2;
const DAY_MS = 24 * 60 * 60 * 1000;

type OccasionRow = {
  id: string;
  user_id: string;
  label: string;
  month: number;
  day: number;
  remind_days_before: number;
  last_reminded_on: string | null;
};

/** A UTC-midnight timestamp back to a plain "YYYY-MM-DD" calendar date. */
function isoDate(msUtcMidnight: number): string {
  return new Date(msUtcMidnight).toISOString().slice(0, 10);
}

/**
 * Emails a reorder nudge for each saved occasion whose reminder window opens
 * today, in Singapore time. `last_reminded_on` is stamped before sending so the
 * hourly cron sends at most once per occasion per year: a stamp inside the
 * current window blocks re-sends, and next year's window opens after it. Returns
 * how many were sent.
 */
export async function sendOccasionReminders(): Promise<number> {
  const admin = createAdminClient();
  const todayStr = singaporeDateString();
  const [ty, tm, td] = todayStr.split("-").map(Number);
  const today = Date.UTC(ty, tm - 1, td);

  const { data } = await admin
    .from("occasions")
    .select("id, user_id, label, month, day, remind_days_before, last_reminded_on");
  const occasions = (data as OccasionRow[] | null) ?? [];

  // Which occasions are inside their reminder window today and not yet nudged
  // for this cycle? Occasions recur each year, so roll to next year once passed.
  const due: { occ: OccasionRow; daysBefore: number; windowOpened: string }[] = [];
  for (const occ of occasions) {
    let nextOcc = Date.UTC(ty, occ.month - 1, occ.day);
    if (nextOcc < today) nextOcc = Date.UTC(ty + 1, occ.month - 1, occ.day);
    const daysUntil = Math.round((nextOcc - today) / DAY_MS);
    if (daysUntil < 0 || daysUntil > occ.remind_days_before) continue;
    const windowOpened = isoDate(nextOcc - occ.remind_days_before * DAY_MS);
    // Already handled this cycle if the last stamp is on or after the window open.
    if (occ.last_reminded_on && occ.last_reminded_on >= windowOpened) continue;
    due.push({ occ, daysBefore: daysUntil, windowOpened });
  }
  if (due.length === 0) return 0;

  // Customer names in one query; their email comes from auth per user.
  const userIds = [...new Set(due.map((d) => d.occ.user_id))];
  const { data: profileRows } = await admin
    .from("profiles")
    .select("id, full_name")
    .in("id", userIds);
  const nameById = new Map(
    ((profileRows as { id: string; full_name: string | null }[] | null) ?? []).map((p) => [
      p.id,
      p.full_name ?? "",
    ]),
  );

  let sent = 0;
  const sentPerUser = new Map<string, number>();
  for (const { occ, daysBefore, windowOpened } of due) {
    if (sent >= MAX_PER_RUN) break;
    const already = sentPerUser.get(occ.user_id) ?? 0;
    if (already >= MAX_PER_USER_PER_RUN) continue;
    const { data: userData } = await admin.auth.admin.getUserById(occ.user_id);
    const email = userData?.user?.email;
    if (!email) continue;

    // This is marketing, so skip anyone who asked to stop hearing from us. The
    // address only becomes known one customer at a time here, since it comes
    // from the auth lookup above, so this is checked per recipient.
    const suppressed = await fetchSuppressedEmails([email]);
    if (suppressed.has(email.trim().toLowerCase())) continue;
    // No footer link means no lawful marketing send, so skip rather than mail
    // without a way out.
    const optOutToken = await fetchOptOutToken(email);
    if (!optOutToken) continue;

    // Stamp before sending so a failed send never becomes a daily repeat, and
    // treat the stamp as the claim: it re-checks that nothing has been sent for
    // this cycle since the read, so only one of two overlapping runs takes the
    // occasion. A write that comes back with no row claimed nothing, and sending
    // on it would turn a once-a-year reminder into an hourly one.
    const { data: claimed } = await admin
      .from("occasions")
      .update({ last_reminded_on: todayStr })
      .eq("id", occ.id)
      .or(`last_reminded_on.is.null,last_reminded_on.lt.${windowOpened}`)
      .select("id")
      .maybeSingle();
    if (!claimed) continue;

    await sendOccasionReminderEmail(
      email,
      nameById.get(occ.user_id) ?? "",
      occ.label,
      daysBefore,
      optOutToken,
    );
    sent += 1;
    sentPerUser.set(occ.user_id, already + 1);
  }
  return sent;
}
