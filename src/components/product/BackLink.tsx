"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSyncExternalStore, type MouseEvent } from "react";
import { getNavSnapshot, getServerNavSnapshot, subscribeNav } from "@/lib/nav-history";

/** Where "Back" goes, in words, for the pages a product is usually opened from. */
function backLabel(path: string): string {
  if (path === "/") return "Back to home";
  if (path === "/menu") return "Back to menu";
  if (path === "/cart") return "Back to cart";
  if (path.startsWith("/account")) return "Back to your account";
  if (path.startsWith("/wishlist")) return "Back to the wishlist";
  return "Back";
}

/**
 * The product page's back link. When the visitor came from another page of the
 * site, it steps back through the browser history to it, so that page returns
 * as they left it: scroll, filters and the swipe position of each row. When
 * there is nothing on the site to go back to (a shared link, a new tab, a
 * refresh), it opens the menu instead.
 */
export function BackLink() {
  const router = useRouter();
  const { previous } = useSyncExternalStore(subscribeNav, getNavSnapshot, getServerNavSnapshot);

  function goBack(event: MouseEvent<HTMLAnchorElement>) {
    // Ctrl or Cmd click still opens the link in a new tab.
    if (!previous || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    router.back();
  }

  return (
    <Link
      href={previous ?? "/menu"}
      onClick={goBack}
      className="text-sm font-semibold text-rose-ink transition hover:text-rose"
    >
      ← {previous ? backLabel(previous) : "Back to menu"}
    </Link>
  );
}
