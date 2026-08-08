"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { useDialog } from "@/lib/useDialog";
import { signOutAndRedirect } from "@/lib/supabase/browser";
import { useAdmin } from "./AdminStore";

type NavItem = { href: string; label: string };

/** Last-updated stamp + manual refresh, shown in the sidebar and drawer. */
function RefreshRow() {
  const { refresh, lastUpdated } = useAdmin();
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex items-center justify-between gap-2 px-4 pb-1 text-xs text-muted">
      <span>
        {lastUpdated
          ? `Updated ${lastUpdated.toLocaleTimeString("en-SG", { hour: "numeric", minute: "2-digit" })}`
          : "Loading…"}
      </span>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void refresh().finally(() => setBusy(false));
        }}
        className="font-semibold text-rose-ink transition hover:text-rose active:scale-95 disabled:opacity-50"
      >
        {busy ? "Refreshing…" : "Refresh"}
      </button>
    </div>
  );
}

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
      { href: "/admin/build-a-box", label: "Build a box" },
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
  const { error, settings, hydrated, refresh, loading } = useAdmin();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);
  useDialog(drawerOpen, () => setDrawerOpen(false), drawerRef);

  // Hide the catalogue links for features that are switched off, so admin only
  // surfaces what the storefront is actually using.
  const groups = navGroups.map((group) =>
    group.label === "Catalogue"
      ? {
          ...group,
          items: group.items.filter(
            (item) =>
              (item.href !== "/admin/bundles" || settings.features.bundles) &&
              (item.href !== "/admin/build-a-box" || settings.features.buildABox),
          ),
        }
      : group,
  );

  function isActive(href: string) {
    return href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);
  }

  async function signOut() {
    // Full reload so middleware re-evaluates with the cleared session.
    await signOutAndRedirect("/admin/login");
  }

  function navLinkClass(href: string) {
    return cn(
      "block rounded-xl px-3 py-2 text-sm font-semibold transition active:scale-[0.98]",
      isActive(href) ? "bg-blush-soft text-rose-ink" : "text-ink hover:bg-marble/60",
    );
  }

  function renderNav() {
    return (
      <nav className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4" aria-label="Admin sections">
        {groups.map((group) => (
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
    <Link
      href="/admin"
      onClick={() => setDrawerOpen(false)}
      aria-label="Munchies Admin, go to dashboard"
      className="flex items-center gap-2 px-4 py-4 transition hover:opacity-80 active:scale-[0.99]"
    >
      <Image src="/logo.png" alt="" width={512} height={512} className="h-8 w-8" />
      <span className="font-display text-2xl font-semibold">Munchies Admin</span>
    </Link>
  );

  return (
    <div className="min-h-screen bg-cream lg:flex">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-line bg-white lg:flex">
        {brand}
        <RefreshRow />
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
              <Link
                href="/admin"
                onClick={() => setDrawerOpen(false)}
                aria-label="Munchies Admin, go to dashboard"
                className="flex items-center gap-2 transition hover:opacity-80 active:scale-[0.99]"
              >
                <Image src="/logo.png" alt="" width={512} height={512} className="h-8 w-8" />
                <span className="font-display text-2xl font-semibold">Munchies Admin</span>
              </Link>
              <button
                type="button"
                aria-label="Close menu"
                onClick={() => setDrawerOpen(false)}
                className="flex h-10 w-10 items-center justify-center rounded-full text-xl leading-none text-muted transition hover:bg-blush-soft hover:text-ink"
              >
                ✕
              </button>
            </div>
            <RefreshRow />
            {renderNav()}
          </div>
        </div>
      )}

      {/* Content */}
      <div className="min-w-0 flex-1">
        {error && (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-danger/30 bg-danger-soft px-5 py-2 text-center text-sm font-semibold text-danger-ink"
          >
            <span>
              <span aria-hidden="true">⚠</span> {error}
            </span>
            {/* Nothing below has loaded yet, so the banner has to carry the way
                out. Without it the page sits on its loading state for good and
                the only fix she can find is closing the tab. */}
            {/* The tap has to visibly do something. refresh only clears the
                error when it works, so on a second failure the screen was byte
                for byte identical and the button read as dead. */}
            {!hydrated && (
              <button
                type="button"
                onClick={() => void refresh()}
                disabled={loading}
                className="rounded-full bg-danger px-3 py-1 text-xs font-semibold text-white transition hover:brightness-110 active:scale-95 disabled:opacity-60"
              >
                {loading ? "Trying…" : "Try again"}
              </button>
            )}
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
