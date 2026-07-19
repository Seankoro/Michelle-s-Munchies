"use client";

import { useEffect, useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase/browser";

/**
 * Reactive Supabase auth state for client-side nav. `ready` flips true once the
 * session has resolved, so a placeholder can hold the layout until then. One
 * home for the effect the header, ribbon, and drawer all used to copy.
 */
export function useSignedIn(): { signedIn: boolean; ready: boolean } {
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

  return { signedIn, ready };
}
