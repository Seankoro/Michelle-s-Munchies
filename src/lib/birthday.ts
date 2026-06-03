import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchStoreSettings } from "@/lib/settings";
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
  const now = new Date();
  const year = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");

  const { data } = await supabase
    .from("profiles")
    .select("id, birthday, birthday_rewarded_year")
    .not("birthday", "is", null)
    .or(`birthday_rewarded_year.is.null,birthday_rewarded_year.lt.${year}`);
  const profiles =
    (data as { id: string; birthday: string; birthday_rewarded_year: number | null }[] | null) ??
    [];

  const todays = profiles.filter((p) => {
    // birthday is yyyy-mm-dd; match on month + day.
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

    await supabase.from("points_ledger").insert({
      user_id: profile.id,
      order_id: null,
      delta: settings.birthdayRewardPoints,
      reason: "birthday",
    });

    // Email the greeting (best-effort) — resolve the address from auth.
    const { data: userData } = await supabase.auth.admin.getUserById(profile.id);
    const email = userData.user?.email;
    if (email) await sendBirthdayEmail(email, settings.birthdayRewardPoints);
    rewarded += 1;
  }
  return rewarded;
}
