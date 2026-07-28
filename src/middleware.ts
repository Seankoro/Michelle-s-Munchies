import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Per-request CSP with a script nonce, replacing the static 'unsafe-inline'
 * policy that used to live in next.config.mjs. Next reads the nonce off the
 * request's Content-Security-Policy header and stamps it onto its own inline
 * bootstrap scripts; our JSON-LD tags read it from x-nonce via headers().
 * 'strict-dynamic' lets those trusted scripts load the chunk files they need,
 * while any script an attacker injects has no nonce and is refused.
 */
function buildCsp(nonce: string): string {
  const isDev = process.env.NODE_ENV !== "production";
  const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  return [
    "default-src 'self'",
    "base-uri 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${supabase}`.trim(),
    "font-src 'self' data:",
    `connect-src 'self' ${supabase} https://api.stripe.com https://*.ingest.de.sentry.io${isDev ? " ws: wss:" : ""}`.trim(),
    "frame-src https://js.stripe.com https://checkout.stripe.com https://accounts.google.com",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}

/**
 * Refreshes the Supabase session on every request so server components see a
 * fresh user, and guards the /account area, sending signed-out visitors to
 * sign in. The auth pages themselves are excluded to avoid a redirect loop.
 */
export async function middleware(request: NextRequest) {
  const nonceBytes = new Uint8Array(16);
  crypto.getRandomValues(nonceBytes);
  const nonce = btoa(String.fromCharCode(...nonceBytes));
  const csp = buildCsp(nonce);
  // On the request so Next applies the nonce to its inline scripts and our
  // pages can read it; echoed on the response so the browser enforces it.
  request.headers.set("x-nonce", nonce);
  request.headers.set("content-security-policy", csp);

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  // Account pages that need no session. Sign in, sign up, and the password-reset
  // flow. Forgot and reset MUST be reachable while signed out, or a locked-out
  // customer can never recover their password.
  const isAuthPage =
    path.startsWith("/account/sign-in") ||
    path.startsWith("/account/sign-up") ||
    path.startsWith("/account/forgot") ||
    path.startsWith("/account/reset");

  if (path.startsWith("/account") && !isAuthPage && !user) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/account/sign-in";
    redirectUrl.searchParams.set("next", path);
    return NextResponse.redirect(redirectUrl);
  }

  // A signed-in visitor has no reason to see the sign-in/sign-up forms. Send
  // them on to wherever they were headed (or /account), honoring `next` only
  // when it resolves back to our own origin, so this can't become an open
  // redirect (forgot/reset stay reachable while signed in, e.g. to change a
  // password from an active session).
  const isSignInOrSignUp = path.startsWith("/account/sign-in") || path.startsWith("/account/sign-up");
  if (isSignInOrSignUp && user) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/account";
    redirectUrl.search = "";
    const nextParam = request.nextUrl.searchParams.get("next");
    if (nextParam) {
      try {
        const resolved = new URL(nextParam, request.nextUrl.origin);
        if (resolved.origin === request.nextUrl.origin) {
          redirectUrl.pathname = resolved.pathname;
          redirectUrl.search = resolved.search;
        }
      } catch {
        // Malformed `next`, fall back to /account.
      }
    }
    return NextResponse.redirect(redirectUrl);
  }

  // Only a signed-in admin whose email is in ADMIN_EMAILS reaches the admin area.
  // The login page is exempt. This is the authoritative gate, and admin Server
  // Actions also re-check via requireAdmin().
  if (path.startsWith("/admin") && !path.startsWith("/admin/login")) {
    const admins = (process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
    const isAdmin = !!user?.email && admins.includes(user.email.toLowerCase());
    if (!isAdmin) {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = "/admin/login";
      redirectUrl.search = "";
      return NextResponse.redirect(redirectUrl);
    }
  }

  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    // Run on everything except Next internals and static image assets.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico)$).*)",
  ],
};
