import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

// The cookie updatePassword requires before it accepts a new password (see
// account/actions.ts). Only set below, right after a genuine recovery-link
// exchange, so a session that reaches /account/reset some other way (e.g. left
// signed in on a shared device) can't be used to change the password (LOW-19).
const RECOVERY_COOKIE = "mm-pw-recovery";

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
    const { error } = await supabase.auth.exchangeCodeForSession(code);
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
      return response;
    }
  }

  // The code was missing, expired, or already used. Let the sign-in page know
  // so it can explain rather than silently dumping the visitor on a blank form.
  return NextResponse.redirect(new URL("/account/sign-in?error=auth", origin));
}
