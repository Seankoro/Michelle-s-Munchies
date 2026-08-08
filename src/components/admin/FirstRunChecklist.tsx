"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAdmin } from "@/components/admin/AdminStore";
import { cn } from "@/lib/cn";

const DISMISS_KEY = "mm-firstrun-dismissed";

/**
 * Setup nudge for a brand-new bakery. Shows on the dashboard only while a
 * required step is still undone, so it disappears on its own once Michelle is
 * set up, and can be hidden early. Each step reflects live data, not a saved
 * flag, so it can never say "done" for something that was later cleared.
 */
export function FirstRunChecklist() {
  const { products, settings } = useAdmin();
  // Assume hidden until storage is read, so a dismissed checklist never flashes.
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    setDismissed(localStorage.getItem(DISMISS_KEY) === "1");
  }, []);

  const items = [
    {
      done: products.length > 0,
      label: "Add your first treat",
      href: "/admin/products",
      cta: "Add a product",
    },
    {
      done: settings.pickupLocation.trim().length > 0,
      label: "Set your pickup location",
      href: "/admin/settings#settings-pickup",
      cta: "Set location",
    },
    {
      done: settings.mascotMessages.length > 0,
      label: "Add a welcome line from Michelle",
      href: "/admin/settings#settings-says",
      cta: "Write it",
      optional: true,
    },
  ];
  const requiredLeft = items.filter((i) => !i.done && !i.optional).length;
  if (dismissed || requiredLeft === 0) return null;

  function hide() {
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // storage unavailable, just hide for this session
    }
    setDismissed(true);
  }

  return (
    <section className="mt-6 rounded-2xl border border-rose/40 bg-blush-soft/40 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl font-semibold">Let&rsquo;s get your bakery ready</h2>
          <p className="mt-1 text-sm text-muted">A couple of quick steps before your first order.</p>
        </div>
        <button
          type="button"
          onClick={hide}
          className="shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold text-muted transition hover:text-ink"
        >
          Hide
        </button>
      </div>
      <ul className="mt-4 flex flex-col gap-2">
        {items.map((item) => (
          <li
            key={item.label}
            className="flex items-center justify-between gap-3 rounded-xl bg-white/70 px-3 py-2.5"
          >
            <span className="flex items-center gap-2.5 text-sm">
              <span
                className={cn(
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs",
                  item.done ? "bg-success text-white" : "border border-line bg-white text-muted",
                )}
              >
                {item.done ? "✓" : ""}
              </span>
              <span className={cn(item.done && "text-muted line-through")}>
                {item.label}
                {item.optional && !item.done && <span className="text-muted"> (optional)</span>}
              </span>
            </span>
            {!item.done && (
              <Link
                href={item.href}
                className="shrink-0 text-sm font-semibold text-rose-ink transition hover:text-rose"
              >
                {item.cta} →
              </Link>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
