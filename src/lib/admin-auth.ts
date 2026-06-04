import "server-only";
import { createServerSupabase } from "@/lib/supabase/server";

/**
 * Admin authorization. An "admin" is a signed-in Supabase user whose email is in
 * the comma-separated ADMIN_EMAILS allow-list. This is enforced server-side on
 * every admin Server Action and in middleware, the admin UI gate is cosmetic.
 */
export function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return adminEmails().includes(email.trim().toLowerCase());
}

export async function currentUserIsAdmin(): Promise<boolean> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return isAdminEmail(user?.email);
}

/** Throws if the caller isn't a signed-in admin. Call first in every admin action. */
export async function requireAdmin(): Promise<void> {
  if (!(await currentUserIsAdmin())) {
    throw new Error("Not authorized.");
  }
}
