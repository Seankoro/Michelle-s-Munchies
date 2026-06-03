import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

// Handles the redirect from magic-link / email-confirmation links: exchanges
// the one-time code for a session, then sends the user on their way.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  // Resolve the post-login target with the SAME URL parser that builds the
  // Location header, then trust it only if it stays on our origin. Comparing
  // origins after parsing closes open redirects, including parser-differential
  // tricks where tab/CR/LF in `next` get stripped (e.g. "/<TAB>/evil.com"
  // becomes "//evil.com" -> a different host).
  let target = new URL("/account", origin);
  const nextParam = searchParams.get("next");
  if (nextParam) {
    try {
      const resolved = new URL(nextParam, origin);
      if (resolved.origin === origin) target = resolved;
    } catch {
      // Malformed `next` — keep the safe default.
    }
  }

  if (code) {
    const supabase = await createServerSupabase();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(target);
    }
  }

  return NextResponse.redirect(new URL("/account/sign-in?error=auth", origin));
}
