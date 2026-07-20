"use client";

import Link from "next/link";

/**
 * The product page's "back to menu" link. It sets a one-shot flag so the menu
 * restores the filters and scroll you left it at, giving a "never left" feel.
 * A plain nav to the menu does not set the flag, so that starts fresh instead.
 */
export function BackToMenuLink() {
  return (
    <Link
      href="/menu"
      onClick={() => {
        try {
          sessionStorage.setItem("mm-menu-restore", "1");
        } catch {
          // Storage blocked; the link still navigates, just without the restore.
        }
      }}
      className="text-sm font-semibold text-rose-deep transition hover:text-rose"
    >
      ← Back to menu
    </Link>
  );
}
