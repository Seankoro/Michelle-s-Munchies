import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchStoreSettings } from "@/lib/settings";
import { takeStashedReferralCode } from "@/lib/referrals-pending";

// The cookie updatePassword requires before it accepts a new password (see
// account/actions.ts). Only set below, right after a genuine recovery-link
// exchange, so a session that reaches /account/reset some other way (e.g. left
// signed in on a shared device) can't be used to change the password (LOW-19).
const RECOVERY_COOKIE = "mm-pw-recovery";

// How new an account has to be for a parked referral code to count. It matches
// the life of the cookie that carries the code, so the only account a code can
// land on is one created during the same sign-up it was typed into.
const NEW_ACCOUNT_WINDOW_MS = 30 * 60_000;

/**
 * Attribute a referral to the account we have just signed in, when the customer
 * parked a code on the sign-up page before Google or a magic link took them off
 * it. Only a genuinely new account qualifies: the profile has to have been
 * created inside the cookie's own window and must have no referrer yet, so a
 * regular signing in again cannot pick up a code left behind on the phone.
 *
 * The rules for the code itself are the ones linkReferral applies on the
 * email-and-password path (account/actions.ts): referrals have to be switched
 * on, the code has to resolve to somebody, nobody refers themselves, and a
 * duplicate is fine. That function is private to its own module, so the rules
 * are repeated here rather than shared, and this stays private to the route for
 * the same reason: a referral may only ever be attributed to the user whose
 * one-time code we just exchanged, never to a user id a caller hands us.
 *
 * Best-effort from end to end. A referral is worth a few dollars and none of it
 * may cost the customer the sign-in they were in the middle of.
 */
async function applyStashedReferral(refereeUserId: string): Promise<void> {
  try {
    const code = await takeStashedReferralCode();
    if (!code) return;
    if (!(await fetchStoreSettings()).features.referrals) return; // referrals turned off
    const admin = createAdminClient();

    const cutoff = new Date(Date.now() - NEW_ACCOUNT_WINDOW_MS).toISOString();
    const { data: refereeRow } = await admin
      .from("profiles")
      .select("referred_by")
      .eq("id", refereeUserId)
      .gte("created_at", cutoff)
      .maybeSingle();
    const referee = refereeRow as { referred_by: string | null } | null;
    // No row means the account is older than the window, i.e. not a new sign-up.
    if (!referee || referee.referred_by) return;

    const { data: refProfile } = await admin
      .from("profiles")
      .select("id")
      .eq("referral_code", code)
      .maybeSingle();
    const referrer = refProfile as { id: string } | null;
    if (!referrer || referrer.id === refereeUserId) return; // unknown code or self-referral

    await admin.from("profiles").update({ referred_by: code }).eq("id", refereeUserId);
    const { error } = await admin.from("referrals").insert({
      referrer_user_id: referrer.id,
      referee_user_id: refereeUserId,
      code,
    });
    // 23505 means already referred, since referee_user_id is unique. Fine to ignore.
    if (error && error.code !== "23505") {
      console.error("[referral] link failed:", error.message);
    }
  } catch (err) {
    console.error("[referral] callback link failed (suppressed):", err);
  }
}

// Handles the redirect from magic-link and email-confirmation links. Exchanges
// the one-time code for a session, then sends the user on their way.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  // Resolve the post-login target with the same URL parser that builds the
  // Location header, then trust it only if it stays on our origin. Comparing
  // origins after parsing closes open redirects, including parser-differential
  // tricks where a tab, CR, or LF in `next` gets stripped, so "/<TAB>/evil.com"
  // becomes "//evil.com", a different host.
  let target = new URL("/account", origin);
  const nextParam = searchParams.get("next");
  if (nextParam) {
    try {
      const resolved = new URL(nextParam, origin);
      if (resolved.origin === origin) target = resolved;
    } catch {
      // Malformed `next`, keep the safe default.
    }
  }

  if (code) {
    const supabase = await createServerSupabase();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const response = NextResponse.redirect(target);
      // sendPasswordReset always points its recovery link's `next` at exactly
      // this path, so landing here means the code we just exchanged came from
      // a genuine "forgot password" email, not from a magic link or OAuth.
      if (target.pathname === "/account/reset") {
        response.cookies.set(RECOVERY_COOKIE, "1", {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          maxAge: 10 * 60,
          path: "/account/reset",
        });
      }
      // Google and magic links leave the site before the sign-up form can hand
      // the referral code to signUpWithPassword, so on those two paths the code
      // reaches us here in a cookie instead. Taken on every successful exchange,
      // which is also how a stale code gets cleared rather than left lying around.
      const signedInUserId = data.user?.id;
      if (signedInUserId) await applyStashedReferral(signedInUserId);
      return response;
    }
  }

  // The code was missing, expired, or already used. Let the sign-in page know
  // so it can explain rather than silently dumping the visitor on a blank form.
  return NextResponse.redirect(new URL("/account/sign-in?error=auth", origin));
}
