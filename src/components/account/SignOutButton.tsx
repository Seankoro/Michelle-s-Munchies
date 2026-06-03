"use client";

import { signOut } from "@/app/account/actions";

export function SignOutButton() {
  async function handleSignOut() {
    await signOut();
    // Full reload so the cleared session is reflected everywhere, and land on
    // the sign in page rather than the homepage.
    window.location.assign("/account/sign-in");
  }

  return (
    <button
      type="button"
      onClick={handleSignOut}
      className="rounded-full border border-line bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:border-rose"
    >
      Sign out
    </button>
  );
}
