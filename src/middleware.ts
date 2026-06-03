import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Refreshes the Supabase session on every request (so server components see a
 * fresh user) and guards the /account area, sending signed-out visitors to
 * sign in. The auth pages themselves are excluded to avoid a redirect loop.
 */
export async function middleware(request: NextRequest) {
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
  // Public account pages (no session needed): sign in/up and the password-reset
  // flow. Forgot/reset MUST be reachable while signed out, or a locked-out
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

  // Admin area: only a signed-in admin (email in ADMIN_EMAILS) gets in; the
  // login page is exempt. This is the authoritative gate — admin Server Actions
  // also re-check via requireAdmin().
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

  return response;
}

export const config = {
  matcher: [
    // Run on everything except Next internals and static image assets.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico)$).*)",
  ],
};
