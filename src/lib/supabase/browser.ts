"use client";

import { createBrowserClient } from "@supabase/ssr";

/** Auth-aware Supabase client for client components, reading the session cookie. */
export function createBrowserSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

/**
 * Sign out and hard-reload to `dest`, so the header and every auth-aware bit
 * re-read the now-empty session. Never throws, the reload re-evaluates either way.
 */
export async function signOutAndRedirect(dest: string): Promise<void> {
  try {
    await createBrowserSupabase().auth.signOut();
  } catch {
    // ignore, the reload below re-evaluates the session regardless
  }
  window.location.assign(dest);
}
