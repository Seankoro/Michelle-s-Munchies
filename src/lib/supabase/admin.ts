import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Admin Supabase client (service role key). BYPASSES Row-Level Security, so it
 * must NEVER be imported into client components or shipped to the browser — the
 * `server-only` import above turns any such accidental use into a build error.
 *
 * Use this on the server for: creating/reading orders, the admin dashboard, and
 * Stripe webhook handling. Created lazily so the app boots before env is set.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Supabase admin client is not configured. Set NEXT_PUBLIC_SUPABASE_URL " +
        "and SUPABASE_SERVICE_ROLE_KEY in .env.local (server-only).",
    );
  }

  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
