"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase/browser";

/** Header link that reflects auth state: "Account" when signed in, else "Sign in". */
export function AccountNav() {
  const [signedIn, setSignedIn] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const supabase = createBrowserSupabase();
    supabase.auth.getUser().then(({ data }) => {
      setSignedIn(Boolean(data.user));
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setSignedIn(Boolean(session?.user));
      setReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Until the session resolves, show a same-size placeholder so we never flash
  // the wrong label (and never shift layout).
  if (!ready) {
    return (
      <span
        aria-hidden="true"
        className="hidden h-9 w-20 animate-pulse rounded-full border border-line bg-marble/60 sm:inline-block"
      />
    );
  }

  return (
    <Link
      href={signedIn ? "/account" : "/account/sign-in"}
      className="hidden rounded-full border border-line bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:border-rose active:scale-[0.97] sm:inline-block"
    >
      {signedIn ? "Account" : "Sign in"}
    </Link>
  );
}
