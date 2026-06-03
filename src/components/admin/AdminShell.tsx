"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, useState, type ReactNode } from "react";
import { RibbonBow } from "@/components/ui/RibbonBow";
import { cn } from "@/lib/cn";
import { useDialog } from "@/lib/useDialog";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { useAdmin } from "./AdminStore";

type NavItem = { href: string; label: string };

// Grouped so 13 destinations read as four scannable sections instead of a flat
// wall of links. Settings sits on its own at the foot of the sidebar.
const navGroups: { label: string; items: NavItem[] }[] = [
  {
    label: "Overview",
    items: [
      { href: "/admin", label: "Dashboard" },
      { href: "/admin/analytics", label: "Insights" },
    ],
  },
  {
    label: "Orders & prep",
    items: [
      { href: "/admin/orders", label: "Orders" },
      { href: "/admin/bake-list", label: "Bake list" },
      { href: "/admin/shopping-list", label: "Shopping list" },
      { href: "/admin/packing-slips", label: "Packing slips" },
    ],
  },
  {
    label: "Catalogue",
    items: [
      { href: "/admin/products", label: "Products" },
      { href: "/admin/bundles", label: "Bundles" },
      { href: "/admin/build-a-box", label: "Build-a-box" },
    ],
  },
  {
    label: "Marketing",
    items: [
      { href: "/admin/promos", label: "Promos" },
      { href: "/admin/newsletter", label: "Newsletter" },
      { href: "/admin/instagram", label: "Instagram" },
    ],
  },
];
const settingsItem: NavItem = { href: "/admin/settings", label: "Settings" };

export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { error } = useAdmin();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);
  useDialog(drawerOpen, () => setDrawerOpen(false), drawerRef);

  function isActive(href: string) {
    return href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);
  }

  async function signOut() {
    try {
      await createBrowserSupabase().auth.signOut();
    } catch {
      // ignore
    }
    // Full reload so middleware re-evaluates with the cleared session.
    window.location.assign("/admin/login");
  }

  function navLinkClass(href: string) {
    return cn(
      "block rounded-xl px-3 py-2 text-sm font-semibold transition active:scale-[0.98]",
      isActive(href) ? "bg-blush-soft text-rose-deep" : "text-ink hover:bg-marble/60",
    );
  }

  function renderNav() {
    return (
      <nav className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4" aria-label="Admin sections">
        {navGroups.map((group) => (
          <div key={group.label}>
            <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-muted">
              {group.label}
            </p>
            <div className="flex flex-col gap-0.5">
              {group.items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setDrawerOpen(false)}
                  aria-current={isActive(item.href) ? "page" : undefined}
                  className={navLinkClass(item.href)}
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
        ))}

        <div className="mt-auto border-t border-line pt-3">
          <Link
            href={settingsItem.href}
            onClick={() => setDrawerOpen(false)}
            aria-current={isActive(settingsItem.href) ? "page" : undefined}
            className={navLinkClass(settingsItem.href)}
          >
            {settingsItem.label}
          </Link>
          <button
            type="button"
            onClick={signOut}
            className="mt-1 block w-full rounded-xl px-3 py-2 text-left text-sm font-semibold text-ink transition hover:bg-marble/60 active:scale-[0.98]"
          >
            Sign out
          </button>
        </div>
      </nav>
    );
  }

  const brand = (
    <div className="flex items-center gap-2 px-4 py-4">
      <RibbonBow withTails={false} className="h-7 w-9" />
      <span className="font-display text-lg font-semibold">Munchies Admin</span>
    </div>
  );

  return (
    <div className="min-h-screen bg-cream lg:flex">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-line bg-white lg:flex">
        {brand}
        {renderNav()}
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-white px-4 py-3 lg:hidden">
        {brand}
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          aria-label="Open menu"
          aria-expanded={drawerOpen}
          className="rounded-xl border border-line px-3 py-2 text-sm font-semibold transition hover:border-rose active:scale-95"
        >
          Menu
        </button>
      </header>

      {/* Mobile slide-in drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setDrawerOpen(false)}
            className="absolute inset-0 bg-ink/30"
          />
          <div
            ref={drawerRef}
            className="absolute left-0 top-0 flex h-full w-72 max-w-[80%] flex-col bg-white shadow-soft"
          >
            <div className="flex items-center justify-between px-4 py-4">
              <div className="flex items-center gap-2">
                <RibbonBow withTails={false} className="h-7 w-9" />
                <span className="font-display text-lg font-semibold">Munchies Admin</span>
              </div>
              <button
                type="button"
                aria-label="Close menu"
                onClick={() => setDrawerOpen(false)}
                className="rounded-full px-2 text-xl leading-none text-muted transition hover:text-ink"
              >
                ✕
              </button>
            </div>
            {renderNav()}
          </div>
        </div>
      )}

      {/* Content */}
      <div className="min-w-0 flex-1">
        {error && (
          <div className="border-b border-red-200 bg-red-50 px-5 py-2 text-center text-sm font-semibold text-red-700">
            ⚠ {error}
          </div>
        )}
        {/* Keyed on the path so each page gently fades in on navigation. */}
        <main key={pathname} className="mx-auto max-w-6xl animate-[fade-up_0.3s_ease-out] px-5 py-8 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
