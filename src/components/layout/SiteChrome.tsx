"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { SiteHeader } from "./SiteHeader";
import { SiteFooter, type FooterChannel } from "./SiteFooter";
import { WishlistProvider } from "@/components/wishlist/WishlistContext";
import { FeaturesProvider, PaymentsProvider } from "@/components/features/FeaturesProvider";
import type { FeatureFlags } from "@/lib/settings";

/**
 * Renders the storefront header and footer around customer pages, but not around
 * the admin area, which brings its own shell. Keeps a single root layout while
 * giving /admin a clean, separate frame. `features`, fetched server-side in the
 * layout, seed the client feature-flag context.
 */
export function SiteChrome({
  children,
  features,
  footerChannels,
  paymentsEnabled,
}: {
  children: ReactNode;
  features: FeatureFlags;
  footerChannels: FooterChannel[];
  /** True when checkout ends on a Stripe payment page rather than WhatsApp. */
  paymentsEnabled: boolean;
}) {
  const pathname = usePathname();
  const isAdmin = pathname?.startsWith("/admin");

  if (isAdmin) return <>{children}</>;

  return (
    <FeaturesProvider value={features}>
      <PaymentsProvider value={paymentsEnabled}>
      <WishlistProvider>
        {/* Skip link: keyboard/screen-reader users bypass the header nav. */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-rose-deep focus:px-4 focus:py-2 focus:font-semibold focus:text-white focus:shadow-soft"
        >
          Skip to content
        </a>
        <SiteHeader />
        <div id="main-content" tabIndex={-1} className="outline-none">
          {children}
        </div>
        <SiteFooter channels={footerChannels} />
      </WishlistProvider>
      </PaymentsProvider>
    </FeaturesProvider>
  );
}
