"use client";

import { useId, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { cn } from "@/lib/cn";
import { useDialog } from "@/lib/useDialog";
import { RibbonBow } from "@/components/ui/RibbonBow";
import { primaryNav } from "@/lib/nav";
import { useFeatures } from "@/components/features/FeaturesProvider";
import { signOutAndRedirect } from "@/lib/supabase/browser";
import { useSignedIn } from "@/lib/useSignedIn";

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
  const { signedIn, ready: authReady } = useSignedIn();
  const panelId = useId();
  const features = useFeatures();
  const panelRef = useRef<HTMLDivElement>(null);

  // Escape, focus trap, scroll lock, and focus restore for the drawer.
  useDialog(open, () => setOpen(false), panelRef);

  async function handleSignOut() {
    setOpen(false);
    await signOutAndRedirect("/");
  }

  const links = [
    ...primaryNav,
    ...(features.bundles ? [{ href: "/bundles", label: "Bundles" }] : []),
    ...(features.buildABox ? [{ href: "/build-a-box", label: "Build a box" }] : []),
  ];


  return (
    <div className="md:hidden">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label="Open menu"
        onClick={() => setOpen(true)}
        className="group flex flex-col items-center rounded-2xl p-1 transition-transform active:translate-y-0.5"
      >
        <RibbonBow className="h-10 w-12" />
        <span className="-mt-1 text-[0.7rem] font-semibold uppercase tracking-wide text-rose-ink">
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

      {/* Left side bar. `inert` keeps the off-screen drawer out of the tab
          order and away from screen readers while closed. */}
      <div
        id={panelId}
        ref={panelRef}
        inert={!open}
        className={cn(
          "fixed left-0 top-0 z-50 flex h-full w-72 max-w-[85%] flex-col overflow-y-auto border-r border-line bg-white p-4 shadow-soft transition-transform duration-300 ease-out",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <Image src="/logo.png" alt="" width={512} height={512} className="h-9 w-9" />
            <span className="font-hand text-xl font-semibold">Michelle&rsquo;s Munchies</span>
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
            {links.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
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
            signedIn ? (
              <>
                <Link
                  href="/account"
                  onClick={() => setOpen(false)}
                  className="block rounded-xl px-3 py-2.5 font-semibold text-ink transition hover:bg-blush-soft"
                >
                  Account
                </Link>
                <button
                  type="button"
                  onClick={handleSignOut}
                  className="block w-full rounded-xl px-3 py-2.5 text-left font-semibold text-ink transition hover:bg-blush-soft active:scale-[0.98]"
                >
                  Sign out
                </button>
              </>
            ) : (
              <Link
                href="/account/sign-in"
                onClick={() => setOpen(false)}
                className="block rounded-xl px-3 py-2.5 font-semibold text-ink transition hover:bg-blush-soft"
              >
                Sign in
              </Link>
            )
          ) : (
            <span aria-hidden="true" className="m-1 block h-9 animate-pulse rounded-xl bg-marble/60" />
          )}
        </nav>
      </div>
    </div>
  );
}
