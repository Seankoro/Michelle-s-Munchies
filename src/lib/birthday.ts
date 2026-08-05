import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchOptOutToken, fetchSuppressedEmails } from "@/lib/email-optout";
import { fetchStoreSettings } from "@/lib/settings";
import { singaporeDateString } from "@/lib/time";
import { sendBirthdayEmail } from "@/lib/email";

/**
 * Grants birthday reward points to customers whose birthday is today and who
 * haven't already been rewarded this calendar year. Idempotent via the
 * `birthday_rewarded_year` guard, so the hourly cron only grants once. Returns
 * the number of customers rewarded.
 */
export async function grantBirthdayRewards(): Promise<number> {
  const settings = await fetchStoreSettings();
  if (!settings.features.birthdayRewards || settings.birthdayRewardPoints <= 0) return 0;

  const supabase = createAdminClient();
  // "Today" must be Singapore's calendar day, not the server's UTC day, or the
  // match fires on the wrong date for the first 8 hours of each SG day.
  const [y, mm, dd] = singaporeDateString().split("-");
  const year = Number(y);

  const { data } = await supabase
    .from("profiles")
    .select("id, birthday, birthday_rewarded_year")
    .not("birthday", "is", null)
    .or(`birthday_rewarded_year.is.null,birthday_rewarded_year.lt.${year}`);
  const profiles =
    (data as { id: string; birthday: string; birthday_rewarded_year: number | null }[] | null) ??
    [];

  const todays = profiles.filter((p) => {
    // birthday is stored as yyyy-mm-dd. Match on month and day.
    const [, m, d] = p.birthday.split("-");
    return m === mm && d === dd;
  });

  let rewarded = 0;
  for (const profile of todays) {
    // Claim the year first so a concurrent run can't double-grant.
    const { data: claimed } = await supabase
      .from("profiles")
      .update({ birthday_rewarded_year: year })
      .eq("id", profile.id)
      .or(`birthday_rewarded_year.is.null,birthday_rewarded_year.lt.${year}`)
      .select("id")
      .maybeSingle();
    if (!claimed) continue; // already claimed by another run

    const { error: pointsError } = await supabase.from("points_ledger").insert({
      user_id: profile.id,
      order_id: null,
      delta: settings.birthdayRewardPoints,
      reason: "birthday",
    });
    // The year is claimed before the points are written, so a failed insert would
    // leave the customer marked as rewarded with nothing in their balance, and the
    // guard would skip them on every later run: the treat is lost for good. Hand
    // the year back as we found it so the next hourly run tries again.
    if (pointsError) {
      console.error("[birthday] points insert failed, releasing the claim:", pointsError.message);
      await supabase
        .from("profiles")
        .update({ birthday_rewarded_year: profile.birthday_rewarded_year })
        .eq("id", profile.id);
      continue;
    }

    // Email the greeting on a best-effort basis, resolving the address from auth.
    // The points are granted either way: they are a reward the customer earned,
    // not marketing, so opting out of offers must not cost them the treat. Only
    // the greeting email is suppressed.
    const { data: userData } = await supabase.auth.admin.getUserById(profile.id);
    const email = userData.user?.email;
    if (email) {
      const suppressed = await fetchSuppressedEmails([email]);
      if (!suppressed.has(email.trim().toLowerCase())) {
        const optOutToken = await fetchOptOutToken(email);
        if (optOutToken) {
          await sendBirthdayEmail(email, settings.birthdayRewardPoints, optOutToken);
        }
      }
    }
    rewarded += 1;
  }
  return rewarded;
}
