"use server";

import { cookies } from "next/headers";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchStoreSettings } from "@/lib/settings";
import { getOrCreateShareToken } from "@/lib/wishlist-share";
import { reorderFromOrderId, type ReorderResult } from "@/lib/cart-resolve";
import { rateLimit } from "@/lib/rate-limit";
import type { AuthError } from "@supabase/supabase-js";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
const SITE_ORIGIN = new URL(SITE_URL).origin;

/** The cookie the /auth/callback route leaves behind after a genuine recovery-link
 *  exchange, so updatePassword can tell a real reset flow apart from any other
 *  signed-in session (see LOW-19). */
const RECOVERY_COOKIE = "mm-pw-recovery";

export type AuthResult = { ok?: true; error?: string; pending?: string };

/**
 * Resolves a client-supplied `next` path to a same-origin path, or null if it's
 * absent or unsafe. Mirrors the origin-comparison guard in /auth/callback/route.ts
 * so a crafted `next` (an absolute URL, or a "//host" trick) can never send a
 * customer off-site after signing in.
 */
function resolveSafeNext(next: string | undefined | null): string | null {
  if (!next) return null;
  try {
    const resolved = new URL(next, SITE_ORIGIN);
    if (resolved.origin !== SITE_ORIGIN) return null;
    const path = resolved.pathname + resolved.search + resolved.hash;
    // Only a single-slash absolute path is a safe local redirect; "//" or "/\\"
    // would be treated as an off-site URL.
    if (!path.startsWith("/") || path.startsWith("//") || path.startsWith("/\\")) return null;
    return path;
  } catch {
    return null;
  }
}

export async function signInWithPassword(email: string, password: string): Promise<AuthResult> {
  if (!(await rateLimit("auth-sign-in", { limit: 10, windowMs: 5 * 60_000 }))) {
    return { error: "Too many attempts. Please wait a few minutes and try again." };
  }
  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  // Generic message on any failure. Anti-enumeration, mirroring sendPasswordReset:
  // the raw Supabase error would otherwise confirm whether an email has an account.
  if (error) return { error: "That email or password is not right." };
  return { ok: true };
}

const MAX_SIGNUP_ATTEMPTS = 3;

/** Recognizes the opaque 500 GoTrue raises when its new-user DB trigger fails,
 *  e.g. the rare case where a freshly generated referral_code collides with an
 *  existing one. Retrying regenerates the code instead of surfacing a raw
 *  database error to the customer. */
function isSignupDbFailure(error: AuthError): boolean {
  return error.status === 500 && /database error/i.test(error.message);
}

async function attemptSignUp(
  supabase: Awaited<ReturnType<typeof createServerSupabase>>,
  email: string,
  password: string,
  fullName: string,
) {
  return supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName },
      emailRedirectTo: `${SITE_URL}/auth/callback`,
    },
  });
}

export async function signUpWithPassword(
  email: string,
  password: string,
  fullName: string,
  referralCode = "",
): Promise<AuthResult> {
  if (!(await rateLimit("auth-sign-up", { limit: 5, windowMs: 15 * 60_000 }))) {
    return { error: "Too many attempts. Please wait a bit and try again." };
  }
  const supabase = await createServerSupabase();

  let outcome = await attemptSignUp(supabase, email, password, fullName);
  for (
    let attempt = 1;
    attempt < MAX_SIGNUP_ATTEMPTS && outcome.error && isSignupDbFailure(outcome.error);
    attempt++
  ) {
    outcome = await attemptSignUp(supabase, email, password, fullName);
  }
  const { data, error } = outcome;

  if (error) {
    if (isSignupDbFailure(error)) {
      console.error("[auth] signup failed after retries:", error.message);
      return { error: "Something went wrong creating your account. Please try again." };
    }
    return { error: error.message };
  }
  if (data.user && referralCode.trim()) {
    await linkReferral(data.user.id, referralCode);
  }
  // If email confirmation is on, there's no session yet, so prompt to confirm.
  if (!data.session) {
    return { ok: true, pending: "Check your email to confirm your account, then sign in." };
  }
  return { ok: true };
}

/** Record that a new customer was referred by `rawCode`. Best-effort, never throws. */
async function linkReferral(refereeUserId: string, rawCode: string): Promise<void> {
  const code = rawCode.trim().toUpperCase();
  if (!code) return;
  if (!(await fetchStoreSettings()).features.referrals) return; // referrals turned off
  const admin = createAdminClient();
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
}

export async function sendMagicLink(email: string, next?: string): Promise<AuthResult> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!(await rateLimit("auth-magic-link", { limit: 5, windowMs: 15 * 60_000 }))) {
    return { error: "Too many requests. Please wait a bit and try again." };
  }
  if (
    normalizedEmail &&
    !(await rateLimit(`auth-magic-link:${normalizedEmail}`, { limit: 3, windowMs: 60 * 60_000 }))
  ) {
    return { error: "Too many requests for that email. Please wait a bit and try again." };
  }
  const supabase = await createServerSupabase();
  const target = resolveSafeNext(next);
  const emailRedirectTo = target
    ? `${SITE_URL}/auth/callback?next=${encodeURIComponent(target)}`
    : `${SITE_URL}/auth/callback`;
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo },
  });
  if (error) return { error: error.message };
  return { ok: true, pending: "We've emailed you a magic link. Open it on this device to sign in." };
}

/**
 * Step 1 of password reset. Email a recovery link that lands on /account/reset.
 *
 * Anti-enumeration. The response is identical whether or not the email exists,
 * the same message, with errors swallowed so a rate-limit or format error can't
 * leak, and padded to a constant-time floor so existence can't be inferred from
 * how long the request takes, whether we send an email or do nothing.
 */
export async function sendPasswordReset(email: string, next?: string): Promise<AuthResult> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!(await rateLimit("auth-password-reset", { limit: 5, windowMs: 15 * 60_000 }))) {
    return { error: "Too many requests. Please wait a bit and try again." };
  }
  if (
    normalizedEmail &&
    !(await rateLimit(`auth-password-reset:${normalizedEmail}`, { limit: 3, windowMs: 60 * 60_000 }))
  ) {
    return { error: "Too many requests for that email. Please wait a bit and try again." };
  }
  const start = Date.now();
  try {
    const supabase = await createServerSupabase();
    // Carry the caller's destination through the reset link, so /account/reset
    // can send them on to where they originally meant to go (LOW-16).
    const target = resolveSafeNext(next);
    const resetPath = target ? `/account/reset?next=${encodeURIComponent(target)}` : "/account/reset";
    // Result intentionally ignored, Supabase returns success for unknown emails,
    // and we don't surface any error to the client.
    await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${SITE_URL}/auth/callback?next=${encodeURIComponent(resetPath)}`,
    });
  } catch (err) {
    console.error("[auth] password reset error (suppressed from client):", err);
  }
  const MIN_MS = 700;
  const elapsed = Date.now() - start;
  if (elapsed < MIN_MS) await new Promise((r) => setTimeout(r, MIN_MS - elapsed));
  return {
    ok: true,
    pending: "If that email has an account, we've sent a reset link. Check your inbox.",
  };
}

/**
 * Step 2, set a new password. Requires the recovery session from the email link.
 *
 * Also requires the RECOVERY_COOKIE that /auth/callback sets only when it just
 * exchanged a genuine password-recovery code (see route.ts). Without it, any
 * signed-in session (e.g. left open on a shared device) could otherwise reach
 * this action and change the password with no re-authentication (LOW-19).
 */
export async function updatePassword(newPassword: string): Promise<AuthResult> {
  if (newPassword.length < 6) return { error: "Password must be at least 6 characters." };
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Your reset link has expired. Please request a new one." };

  const cookieStore = await cookies();
  if (cookieStore.get(RECOVERY_COOKIE)?.value !== "1") {
    return {
      error: "For your security, please use the password reset link from your email to change your password.",
    };
  }

  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) return { error: error.message };
  // One-time use, so a copied session cookie can't be replayed for a second change.
  cookieStore.delete(RECOVERY_COOKIE);
  return { ok: true };
}

export async function signOut(): Promise<void> {
  const supabase = await createServerSupabase();
  await supabase.auth.signOut();
}

export type ShareLinkResult = { ok: true; url: string } | { ok: false; error: string };

/** Returns the signed-in user's read-only wishlist share link, creating it if needed. */
export async function getWishlistShareLinkAction(): Promise<ShareLinkResult> {
  if (!(await fetchStoreSettings()).features.wishlistSharing) {
    return { ok: false, error: "Wishlist sharing isn’t available right now." };
  }
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Please sign in." };
  const token = await getOrCreateShareToken(user.id);
  return { ok: true, url: `${SITE_URL}/wishlist/share/${token}` };
}

export async function updateProfile(
  fullName: string,
  phone: string,
  birthday: string | null = null,
  dietaryPrefs: string[] = [],
): Promise<AuthResult> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };
  const { error } = await supabase
    .from("profiles")
    .update({
      full_name: fullName,
      phone,
      birthday: birthday || null,
      dietary_prefs: dietaryPrefs,
      updated_at: new Date().toISOString(),
    })
    .eq("id", user.id);
  if (error) return { error: error.message };
  return { ok: true };
}

// ---- Reorder ---------------------------------------------------------------
/**
 * Rebuilds a cart from a past order owned by the signed-in user. Ownership is
 * checked here; the rebuild itself is the shared reorderFromOrderId.
 */
export async function buildReorderCart(orderNumber: string): Promise<ReorderResult> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Please sign in to reorder." };

  // Ownership check via service role, since orders aren't user-readable.
  const admin = createAdminClient();
  const { data: orderRow } = await admin
    .from("orders")
    .select("id, user_id")
    .eq("order_number", orderNumber)
    .maybeSingle();
  const order = orderRow as { id: string; user_id: string | null } | null;
  if (!order || order.user_id !== user.id) {
    return { ok: false, error: "Order not found." };
  }

  return reorderFromOrderId(order.id);
}
