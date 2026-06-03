import { createClient } from "@supabase/supabase-js";

/**
 * Public Supabase client (anon key). Safe for the browser and for server-side
 * reads of public data (products, settings). Subject to Row-Level Security, so
 * it can only ever read what the "Public can read ..." policies allow.
 *
 * Created lazily so the app still boots before Supabase env vars are set.
 */
export function createPublicClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and " +
        "NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local (see .env.local.example).",
    );
  }

  return createClient(url, anonKey, {
    auth: { persistSession: false },
  });
}
