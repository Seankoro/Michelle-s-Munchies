"use client";

import Link from "next/link";
import { useSignedIn } from "@/lib/useSignedIn";

/** Header link that reflects auth state, "Account" when signed in, else "Sign in". */
export function AccountNav() {
  const { signedIn, ready } = useSignedIn();

  // Until the session resolves, show a same-size placeholder so we never flash
  // the wrong label and never shift layout.
  if (!ready) {
    return (
      <span
        aria-hidden="true"
        className="inline-block h-9 w-20 animate-pulse rounded-full border border-line bg-marble/60"
      />
    );
  }

  return (
    <Link
      href={signedIn ? "/account" : "/account/sign-in"}
      className="inline-block whitespace-nowrap rounded-full border border-line bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:border-rose active:scale-[0.97]"
    >
      {signedIn ? "Account" : "Sign in"}
    </Link>
  );
}
