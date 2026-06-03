"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { SiteHeader } from "./SiteHeader";
import { SiteFooter } from "./SiteFooter";
import { WishlistProvider } from "@/components/wishlist/WishlistContext";
import { FeaturesProvider } from "@/components/features/FeaturesProvider";
import type { FeatureFlags } from "@/lib/settings";

/**
 * Renders the storefront header/footer around customer pages, but NOT around
 * the admin area (which brings its own shell). Keeps a single root layout while
 * giving /admin a clean, separate frame. `features` (fetched server-side in the
 * layout) seed the client feature-flag context.
 */
export function SiteChrome({
  children,
  features,
}: {
  children: ReactNode;
  features: FeatureFlags;
}) {
  const pathname = usePathname();
  const isAdmin = pathname?.startsWith("/admin");

  if (isAdmin) return <>{children}</>;

  return (
    <FeaturesProvider value={features}>
      <WishlistProvider>
        <SiteHeader />
        {children}
        <SiteFooter />
      </WishlistProvider>
    </FeaturesProvider>
  );
}
