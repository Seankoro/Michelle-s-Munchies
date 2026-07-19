"use client";

import { Button } from "@/components/ui/Button";
import { signOut } from "@/app/account/actions";

export function SignOutButton() {
  async function handleSignOut() {
    await signOut();
    // Full reload so the cleared session is reflected everywhere, and land on
    // the sign in page rather than the homepage.
    window.location.assign("/account/sign-in");
  }

  return (
    <Button type="button" variant="secondary" size="sm" onClick={handleSignOut}>
      Sign out
    </Button>
  );
}
