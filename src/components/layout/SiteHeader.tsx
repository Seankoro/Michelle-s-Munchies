"use client";

import Link from "next/link";
import { RibbonNav } from "./RibbonNav";
import { RibbonBow } from "@/components/ui/RibbonBow";
import { CartButton } from "@/components/cart/CartButton";
import { AccountNav } from "./AccountNav";
import { primaryNav } from "@/lib/nav";
import { useFeatures } from "@/components/features/FeaturesProvider";

export function SiteHeader() {
  const features = useFeatures();
  // Desktop inline links exclude "Home" (the wordmark already links home).
  const inlineLinks = primaryNav.filter((link) => link.href !== "/");
  // Feature-gated storefront destinations, inserted after "Menu".
  const extraLinks = [
    features.bundles ? { href: "/bundles", label: "Bundles" } : null,
    features.buildABox ? { href: "/build-a-box", label: "Build a box" } : null,
  ].filter((l): l is { href: string; label: string } => l !== null);

  return (
    <header className="sticky top-0 z-40 border-b border-line/70 bg-cream/85 backdrop-blur">
      <div className="mx-auto flex max-w-none items-center justify-between gap-4 px-6 py-3 lg:px-10">
        <Link href="/" className="flex items-center gap-2" aria-label="Michelle's Munchies home">
          <RibbonBow withTails={false} className="h-7 w-9" />
          <span className="font-display text-xl font-semibold sm:text-2xl">
            Michelle&rsquo;s Munchies
          </span>
        </Link>

        <nav aria-label="Primary" className="hidden items-center gap-1 md:flex">
          {[...inlineLinks, ...extraLinks].map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-full px-3 py-2 font-semibold text-ink transition hover:bg-blush-soft active:scale-95"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <AccountNav />
          <CartButton />
          <RibbonNav />
        </div>
      </div>
    </header>
  );
}
