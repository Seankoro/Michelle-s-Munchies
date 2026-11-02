"use client";

import { useEffect, useLayoutEffect } from "react";
import { usePathname } from "next/navigation";
import { noteTraversal, recordPage } from "@/lib/nav-history";

/**
 * Feeds nav-history.ts. Renders nothing. A layout effect, so the page is
 * recorded before the browser paints and a "Back" link never flashes its
 * fallback label first.
 */
export function NavigationTracker() {
  const pathname = usePathname();

  useEffect(() => {
    window.addEventListener("popstate", noteTraversal);
    return () => window.removeEventListener("popstate", noteTraversal);
  }, []);

  useLayoutEffect(() => {
    if (pathname) recordPage(pathname);
  }, [pathname]);

  return null;
}
