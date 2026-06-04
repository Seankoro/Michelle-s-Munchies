"use server";

import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchStoreSettings } from "@/lib/settings";
import { getOrCreateShareToken } from "@/lib/wishlist-share";
import { resolveCartLines } from "@/lib/cart-resolve";
import type { CartItem, SelectedOption } from "@/lib/types";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export type AuthResult = { ok?: true; error?: string; pending?: string };

export async function signInWithPassword(email: string, password: string): Promise<AuthResult> {
  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: error.message };
  return { ok: true };
}

export async function signUpWithPassword(
  email: string,
  password: string,
  fullName: string,
  referralCode = "",
): Promise<AuthResult> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName },
      emailRedirectTo: `${SITE_URL}/auth/callback`,
    },
  });
  if (error) return { error: error.message };
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

export async function sendMagicLink(email: string): Promise<AuthResult> {
  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${SITE_URL}/auth/callback` },
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
export async function sendPasswordReset(email: string): Promise<AuthResult> {
  const start = Date.now();
  try {
    const supabase = await createServerSupabase();
    // Result intentionally ignored, Supabase returns success for unknown emails,
    // and we don't surface any error to the client.
    await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${SITE_URL}/auth/callback?next=/account/reset`,
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

/** Step 2, set a new password. Requires the recovery session from the email link. */
export async function updatePassword(newPassword: string): Promise<AuthResult> {
  if (newPassword.length < 6) return { error: "Password must be at least 6 characters." };
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Your reset link has expired. Please request a new one." };
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) return { error: error.message };
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
export type ReorderResult =
  | { ok: true; items: CartItem[]; skipped: string[] }
  | { ok: false; error: string };

type ReorderItemRow = {
  product_id: string | null;
  product_name: string;
  quantity: number;
  selected_options: SelectedOption[] | null;
};

/**
 * Rebuilds a cart from a past order owned by the signed-in user, re-resolving
 * each line against the current catalog for current price and availability.
 * Lines whose product is gone or sold out, or whose required options no longer
 * exist, are reported as `skipped` rather than silently dropped.
 */
export async function buildReorderCart(orderNumber: string): Promise<ReorderResult> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Please sign in to reorder." };

  // Ownership check and item read via service role, since orders aren't user-readable.
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

  const { data: itemRows } = await admin
    .from("order_items")
    .select("product_id, product_name, quantity, selected_options")
    .eq("order_id", order.id);
  const rows = (itemRows as ReorderItemRow[] | null) ?? [];

  const { items, skipped } = await resolveCartLines(
    rows.map((row) => ({
      productId: row.product_id,
      productName: row.product_name,
      quantity: row.quantity,
      selections: (row.selected_options ?? []).map((o) => ({
        optionName: o.optionName,
        valueLabel: o.valueLabel,
      })),
    })),
  );

  if (items.length === 0) {
    return { ok: false, error: "None of these items are available to reorder right now." };
  }
  return { ok: true, items, skipped };
}
