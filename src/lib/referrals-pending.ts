"use server";

import { cookies } from "next/headers";

// Carries a referral code across a redirect that leaves the site. The sign-up
// form can hand the code straight to signUpWithPassword, but "Sign up with
// Google" and magic links both take the customer off the page before anything
// is submitted, so the code has to be parked on the server before they go and
// picked up again in /auth/callback when they come back.
//
// httpOnly so the page can never read it back, sameSite 'lax' so it does come
// back with the redirect from Google, and one fixed path for both sides: a
// cookie is keyed by name and path, so a clear written under a different path
// would expire nothing.
const REFERRAL_COOKIE = "mm-ref";
const REFERRAL_COOKIE_PATH = "/";

// Half an hour. Long enough to finish the form and Google's consent screen on a
// phone, short enough that a code from an abandoned sign-up cannot sit there
// waiting to attach itself to some later sign-in on the same device.
const REFERRAL_COOKIE_MAX_AGE = 30 * 60;

// A referral code is six upper-case characters from md5 (see the
// profiles.referral_code default in the schema), so anything outside this shape
// is junk and not worth carrying.
const REFERRAL_CODE_RE = /^[A-Z0-9]{1,16}$/;

/**
 * Park the referral code the customer typed or arrived with. Called from the
 * sign-up page while they are still filling the form, not on the tap itself,
 * because the Google button navigates away the moment it is pressed and would
 * outrun a write started at that point.
 *
 * Safe as a public action: it writes one small cookie to the caller's own
 * browser and touches no data, so there is nothing worth rate limiting.
 */
export async function stashReferralCode(rawCode: string): Promise<void> {
  const code = rawCode.trim().toUpperCase();
  if (!REFERRAL_CODE_RE.test(code)) return;
  const cookieStore = await cookies();
  cookieStore.set(REFERRAL_COOKIE, code, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: REFERRAL_COOKIE_MAX_AGE,
    path: REFERRAL_COOKIE_PATH,
  });
}

/**
 * Read the parked code and clear it in the same breath, so one stashed code can
 * only ever be spent on one account. Returns "" when nothing is parked.
 */
export async function takeStashedReferralCode(): Promise<string> {
  const cookieStore = await cookies();
  const code = cookieStore.get(REFERRAL_COOKIE)?.value.trim().toUpperCase() ?? "";
  if (!code) return "";
  cookieStore.set(REFERRAL_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: REFERRAL_COOKIE_PATH,
  });
  // Checked on the way out as well as in, since the value came off the wire.
  return REFERRAL_CODE_RE.test(code) ? code : "";
}
