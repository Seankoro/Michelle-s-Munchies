"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { RibbonBow } from "@/components/ui/RibbonBow";
import { primaryNav } from "@/lib/nav";
import { useFeatures } from "@/components/features/FeaturesProvider";
import { createBrowserSupabase } from "@/lib/supabase/browser";

/**
 * Mobile-only navigation. The Menu ribbon opens a full-height side bar from the
 * left with the Michelle's Munchies name and every link plus the account entry.
 * Hidden on desktop, where the header lays the links out inline. It stays an
 * accessible disclosure, a real button with aria-expanded and aria-controls,
 * Escape closes and restores focus, a tap on the backdrop closes, and focus
 * enters on open.
 */
export function MobileMenu() {
  const [open, setOpen] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const panelId = useId();
  const features = useFeatures();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const firstLinkRef = useRef<HTMLAnchorElement>(null);

  const links = [
    ...primaryNav,
    ...(features.bundles ? [{ href: "/bundles", label: "Bundles" }] : []),
    ...(features.buildABox ? [{ href: "/build-a-box", label: "DIY" }] : []),
  ];

  useEffect(() => {
    const supabase = createBrowserSupabase();
    supabase.auth.getUser().then(({ data }) => {
      setSignedIn(Boolean(data.user));
      setAuthReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setSignedIn(Boolean(session?.user));
      setAuthReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    firstLinkRef.current?.focus();
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <div className="md:hidden">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label="Open menu"
        onClick={() => setOpen(true)}
        className="group flex flex-col items-center rounded-2xl p-1 transition-transform active:translate-y-0.5"
      >
        <RibbonBow className="h-10 w-12" />
        <span className="-mt-1 text-[0.7rem] font-semibold uppercase tracking-wide text-rose-deep">
          Menu
        </span>
      </button>

      {/* Backdrop */}
      <div
        aria-hidden="true"
        onClick={() => setOpen(false)}
        className={cn(
          "fixed inset-0 z-40 bg-ink/40 transition-opacity",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      />

      {/* Left side bar */}
      <div
        id={panelId}
        className={cn(
          "fixed left-0 top-0 z-50 flex h-full w-72 max-w-[85%] flex-col overflow-y-auto border-r border-line bg-white p-4 shadow-soft transition-transform duration-300 ease-out",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <RibbonBow withTails={false} className="h-7 w-9" />
            <span className="font-display text-lg font-semibold">Michelle&rsquo;s Munchies</span>
          </span>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close menu"
            className="rounded-full p-2 text-muted transition hover:bg-blush-soft active:scale-90"
          >
            ✕
          </button>
        </div>

        <nav aria-label="Site" className="mt-4">
          <ul className="flex flex-col">
            {links.map((link, index) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  ref={index === 0 ? firstLinkRef : undefined}
                  onClick={() => setOpen(false)}
                  className="block rounded-xl px-3 py-2.5 font-semibold text-ink transition hover:bg-blush-soft"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
          <hr className="my-2 border-line" />
          <Link
            href="/track"
            onClick={() => setOpen(false)}
            className="block rounded-xl px-3 py-2.5 font-semibold text-ink transition hover:bg-blush-soft"
          >
            Track an order
          </Link>
          {authReady ? (
            <Link
              href={signedIn ? "/account" : "/account/sign-in"}
              onClick={() => setOpen(false)}
              className="block rounded-xl px-3 py-2.5 font-semibold text-ink transition hover:bg-blush-soft"
            >
              {signedIn ? "Account" : "Sign in"}
            </Link>
          ) : (
            <span aria-hidden="true" className="m-1 block h-9 animate-pulse rounded-xl bg-marble/60" />
          )}
        </nav>
      </div>
    </div>
  );
}
