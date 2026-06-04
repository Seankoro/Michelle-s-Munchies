"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { createBrowserSupabase } from "@/lib/supabase/browser";

type WishlistValue = {
  ready: boolean;
  signedIn: boolean;
  isFavourite: (productId: string) => boolean;
  toggle: (productId: string) => void;
};

const WishlistContext = createContext<WishlistValue | null>(null);

/**
 * Tracks the signed-in customer's favourited products. Favourites live in the
 * `wishlists` table, where RLS allows own rows only. Guests have an empty list
 * and the favourite control is hidden for them.
 */
export function WishlistProvider({ children }: { children: ReactNode }) {
  const supabase = useMemo(() => createBrowserSupabase(), []);
  const [userId, setUserId] = useState<string | null>(null);
  const [ids, setIds] = useState<Set<string>>(new Set());
  const [ready, setReady] = useState(false);

  const loadFor = useCallback(
    async (uid: string | null) => {
      if (!uid) {
        setIds(new Set());
        return;
      }
      const { data } = await supabase
        .from("wishlists")
        .select("product_id")
        .eq("user_id", uid);
      setIds(new Set(((data as { product_id: string }[] | null) ?? []).map((w) => w.product_id)));
    },
    [supabase],
  );

  useEffect(() => {
    let active = true;
    supabase.auth.getUser().then(async ({ data }) => {
      if (!active) return;
      const uid = data.user?.id ?? null;
      setUserId(uid);
      await loadFor(uid);
      if (active) setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      const uid = session?.user?.id ?? null;
      setUserId(uid);
      void loadFor(uid);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [supabase, loadFor]);

  const isFavourite = useCallback((productId: string) => ids.has(productId), [ids]);

  const toggle = useCallback(
    (productId: string) => {
      if (!userId) {
        window.location.href = "/account/sign-in";
        return;
      }
      const wasFavourite = ids.has(productId);
      setIds((prev) => {
        const next = new Set(prev);
        if (wasFavourite) next.delete(productId);
        else next.add(productId);
        return next;
      });
      // The Supabase query builder is lazy, it only runs when awaited, so we
      // execute it inside a fire-and-forget async IIFE to keep toggle synchronous.
      void (async () => {
        if (wasFavourite) {
          await supabase
            .from("wishlists")
            .delete()
            .eq("user_id", userId)
            .eq("product_id", productId);
        } else {
          await supabase.from("wishlists").insert({ user_id: userId, product_id: productId });
        }
      })();
    },
    [userId, ids, supabase],
  );

  const value: WishlistValue = {
    ready,
    signedIn: Boolean(userId),
    isFavourite,
    toggle,
  };

  return <WishlistContext.Provider value={value}>{children}</WishlistContext.Provider>;
}

export function useWishlist(): WishlistValue {
  const context = useContext(WishlistContext);
  if (!context) throw new Error("useWishlist must be used within a WishlistProvider");
  return context;
}
