"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { RibbonBow } from "@/components/ui/RibbonBow";
import { primaryNav } from "@/lib/nav";
import { useFeatures } from "@/components/features/FeaturesProvider";
import { signOutAndRedirect } from "@/lib/supabase/browser";
import { useSignedIn } from "@/lib/useSignedIn";

/**
 * The signature interaction, "pull the ribbon to reveal the menu."
 *
 * Under the charm it's a standard, accessible disclosure.
 *  - a real <button> with aria-expanded and aria-controls,
 *  - Escape closes and returns focus to the button,
 *  - clicking outside closes,
 *  - focus moves into the panel on open.
 * The "pull" is conveyed by a gentle tug on hover or press. The panel reveal and
 * tug both calm down automatically under prefers-reduced-motion, see globals.css.
 *
 * This is the desktop menu. On small screens the header hides it and shows the
 * MobileMenu left side-bar instead.
 */
export function RibbonNav() {
  const [open, setOpen] = useState(false);
  const { signedIn, ready: authReady } = useSignedIn();
  const panelId = useId();
  const features = useFeatures();

  // Mirror SiteHeader/MobileMenu: append the feature-gated shop links so the
  // desktop ribbon reveal never omits pages the other menus show.
  const links = [
    ...primaryNav,
    ...(features.bundles ? [{ href: "/bundles", label: "Bundles" }] : []),
    ...(features.buildABox ? [{ href: "/build-a-box", label: "Build a box" }] : []),
  ];

  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const firstLinkRef = useRef<HTMLAnchorElement>(null);

  async function handleSignOut() {
    setOpen(false);
    await signOutAndRedirect("/");
  }

  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    function onPointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    // Move focus into the menu for keyboard users.
    firstLinkRef.current?.focus();

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={open ? "Close menu" : "Open menu"}
        onClick={() => setOpen((value) => !value)}
        className="group flex flex-col items-center rounded-2xl p-1 transition-transform hover:translate-y-1 active:translate-y-1.5"
      >
        <RibbonBow className={cn("h-12 w-14 transition-transform", open && "scale-105")} />
        <span className="-mt-1 text-[0.7rem] font-semibold uppercase tracking-wide text-rose-deep">
          {open ? "Close" : "Menu"}
        </span>
      </button>

      <div
        id={panelId}
        className={cn(
          "absolute right-0 z-50 mt-3 w-60 origin-top-right rounded-2xl border border-line bg-white p-3 shadow-soft transition",
          open ? "visible scale-100 opacity-100" : "invisible scale-95 opacity-0",
        )}
      >
        <nav aria-label="Site">
          <ul className="flex flex-col">
            {links.map((link, index) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  ref={index === 0 ? firstLinkRef : undefined}
                  onClick={() => setOpen(false)}
                  className="block rounded-xl px-3 py-2 font-semibold text-ink transition hover:bg-blush-soft"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
          <hr className="my-2 border-line" />
          <ul className="flex flex-col">
            <li>
              <Link
                href="/track"
                onClick={() => setOpen(false)}
                className="block rounded-xl px-3 py-2 font-semibold text-ink transition hover:bg-blush-soft"
              >
                Track an order
              </Link>
            </li>
            {authReady ? (
              signedIn ? (
                <>
                  <li>
                    <Link
                      href="/account"
                      onClick={() => setOpen(false)}
                      className="block rounded-xl px-3 py-2 font-semibold text-ink transition hover:bg-blush-soft"
                    >
                      Account
                    </Link>
                  </li>
                  <li>
                    <button
                      type="button"
                      onClick={handleSignOut}
                      className="block w-full rounded-xl px-3 py-2 text-left font-semibold text-ink transition hover:bg-blush-soft active:scale-[0.98]"
                    >
                      Sign out
                    </button>
                  </li>
                </>
              ) : (
                <li>
                  <Link
                    href="/account/sign-in"
                    onClick={() => setOpen(false)}
                    className="block rounded-xl px-3 py-2 font-semibold text-ink transition hover:bg-blush-soft"
                  >
                    Sign in
                  </Link>
                </li>
              )
            ) : (
              <li>
                <span
                  aria-hidden="true"
                  className="m-1 block h-7 animate-pulse rounded-xl bg-marble/60"
                />
              </li>
            )}
          </ul>
        </nav>
      </div>
    </div>
  );
}
