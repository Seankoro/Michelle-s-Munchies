"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Allergen, DietaryTag, Product } from "@/lib/types";
import { dietaryMeta } from "@/lib/catalog";
import { ProductCard } from "@/components/product/ProductCard";
import { MascotSays } from "@/components/ui/MascotSays";
import { ScrollRail } from "@/components/ui/ScrollRail";
import { cn } from "@/lib/cn";

/** Allergens that contradict each dietary filter, used to cross-check the
 *  admin-entered tags so a mistagged product never passes a safety filter. */
const DIETARY_ALLERGEN_CONFLICTS: Partial<Record<DietaryTag, Allergen[]>> = {
  nut_free: ["peanuts", "tree_nuts"],
  gluten_free: ["gluten"],
  dairy_free: ["dairy"],
  eggless: ["eggs"],
  vegan: ["dairy", "eggs"],
};

/** Per-tab memory of the menu's filters and scroll, so returning from a product
 *  feels like you never left. Cleared when the browser tab closes. */
const VIEW_KEY = "mm-menu-view";
/** One-shot flag the product page's "back to menu" link sets to request a
 *  restore. A plain nav to the menu leaves it unset, so the menu starts fresh. */
const RESTORE_FLAG = "mm-menu-restore";

/**
 * One category's products as a horizontal scrolling rail on phones and tablets,
 * so the menu reads as short swipeable rows instead of one long vertical list, and
 * a plain grid on desktop. Pure CSS, no JS needed.
 */
function ProductRail({
  label,
  products,
  ratings,
}: {
  label: string;
  products: Product[];
  ratings?: Record<string, { avg: number; count: number }>;
}) {
  return (
    <ScrollRail
      label={label}
      trackClassName="-mx-6 flex gap-4 overflow-x-auto px-6 pb-2 no-scrollbar xl:mx-0 xl:grid xl:grid-cols-4 xl:gap-6 xl:overflow-visible xl:px-0 xl:pb-0"
    >
      {products.map((product) => (
        <div
          key={product.id}
          className="shrink-0 basis-[72%] sm:basis-[40%] lg:basis-[31%] xl:basis-auto"
        >
          <ProductCard product={product} rating={ratings?.[product.id]} />
        </div>
      ))}
    </ScrollRail>
  );
}

export function MenuBrowser({
  products,
  categories,
  initialDietary = [],
  ratings,
}: {
  products: Product[];
  categories: string[];
  initialDietary?: DietaryTag[];
  /** Per-product review averages for card star lines, empty when reviews are off. */
  ratings?: Record<string, { avg: number; count: number }>;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [dietary, setDietary] = useState<DietaryTag[]>(initialDietary);
  const [restored, setRestored] = useState(false);

  // Restore the last-used filters and scroll position when returning to the menu,
  // so tapping into a product and back feels like you never left. Done in an
  // effect (not initial state) to keep the server and client render in sync.
  useEffect(() => {
    try {
      // Only restore when arriving via the product page's "back to menu" link,
      // which sets this one-shot flag. A plain nav to the menu starts fresh.
      if (sessionStorage.getItem(RESTORE_FLAG) === "1") {
        sessionStorage.removeItem(RESTORE_FLAG);
        const raw = sessionStorage.getItem(VIEW_KEY);
        if (raw) {
          const v = JSON.parse(raw) as {
            query?: string;
            category?: string;
            dietary?: DietaryTag[];
            scrollY?: number;
          };
          if (typeof v.query === "string") setQuery(v.query);
          if (typeof v.category === "string") setCategory(v.category);
          if (Array.isArray(v.dietary)) setDietary(v.dietary);
          if (typeof v.scrollY === "number" && v.scrollY > 0) {
            const y = v.scrollY;
            // Wait for the restored sections to lay out before scrolling to them.
            requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo(0, y)));
          }
        }
      }
    } catch {
      // Storage unavailable or malformed, the menu still works without a restore.
    }
    setRestored(true);
  }, []);

  // Once restored, keep that saved view in sync with the current filters and scroll.
  useEffect(() => {
    if (!restored) return;
    const save = () => {
      try {
        sessionStorage.setItem(
          VIEW_KEY,
          JSON.stringify({ query, category, dietary, scrollY: window.scrollY }),
        );
      } catch {
        // Losing the saved view is harmless.
      }
    };
    save();
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(save);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
    };
  }, [restored, query, category, dietary]);

  // Only offer dietary filters that some product actually carries.
  const dietaryTags = useMemo(
    () =>
      (Object.keys(dietaryMeta) as DietaryTag[]).filter((tag) =>
        products.some((p) => p.dietaryTags.includes(tag)),
      ),
    [products],
  );

  function toggleDietary(tag: DietaryTag) {
    setDietary((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  }

  // Search and dietary filter the items. The category tab decides which sections
  // show. Each shown category becomes its own rail. Empty sections drop out.
  // Within a rail, best sellers come first, then recommended, then the rest.
  const sections = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = (product: Product) => {
      const matchesQuery =
        !q ||
        product.name.toLowerCase().includes(q) ||
        product.shortDescription.toLowerCase().includes(q) ||
        (product.longDescription ?? "").toLowerCase().includes(q) ||
        product.category.toLowerCase().includes(q) ||
        // Flavours are option values, so a search for "matcha" should surface a
        // cake that offers it rather than dead-ending on the empty state.
        product.options.some((option) =>
          option.values.some((value) => value.label.toLowerCase().includes(q)),
        );
      const matchesDietary = dietary.every(
        (tag) =>
          product.dietaryTags.includes(tag) &&
          // A dietary tag never overrides the allergen list. If the admin data
          // disagrees (say, "nut-free" tagged on a product listing peanuts),
          // the safe answer for an allergic shopper is to hide it.
          !(DIETARY_ALLERGEN_CONFLICTS[tag] ?? []).some((allergen) =>
            product.allergens.includes(allergen),
          ),
      );
      return matchesQuery && matchesDietary;
    };
    const rank = (p: Product) => (p.isBestSeller ? 0 : p.isRecommended ? 1 : 2);
    const shown = category === "All" ? categories : [category];
    return shown
      .map((cat) => ({
        cat,
        items: products
          .filter((p) => p.category === cat && matches(p))
          .sort((a, b) => rank(a) - rank(b)),
      }))
      .filter((section) => section.items.length > 0);
  }, [products, categories, query, category, dietary]);

  const matchCount = useMemo(
    () => sections.reduce((sum, section) => sum + section.items.length, 0),
    [sections],
  );

  const allCategories = ["All", ...categories];

  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        {/* Categories as a solid, horizontally-scrolling tab strip so they never
            clump on small screens, kept visually distinct from the lighter dietary
            chips below. */}
        <div
          className="-mx-6 flex gap-2 overflow-x-auto px-6 pb-1 no-scrollbar sm:mx-0 sm:flex-wrap sm:px-0 sm:pb-0"
          role="group"
          aria-label="Filter by category"
        >
          {allCategories.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setCategory(option)}
              aria-pressed={category === option}
              className={cn(
                "shrink-0 rounded-full border px-4 py-2 text-sm font-semibold transition active:scale-95",
                category === option
                  ? "border-rose-deep bg-rose-deep text-white"
                  : "border-line bg-white text-ink hover:border-rose",
              )}
            >
              {option}
            </button>
          ))}
        </div>

        <label className="relative block sm:w-64">
          <span className="sr-only">Search the menu</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search treats…"
            className="w-full rounded-full border border-line bg-white px-4 py-2 text-base transition focus:border-rose sm:text-sm"
          />
        </label>
      </div>

      {dietaryTags.length > 0 && (
        <div
          className="-mx-6 mt-3 flex items-center gap-2 overflow-x-auto px-6 pb-1 no-scrollbar sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0"
          role="group"
          aria-label="Filter by dietary need"
        >
          <span className="shrink-0 text-sm font-semibold text-muted">Dietary</span>
          {dietaryTags.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => toggleDietary(tag)}
              aria-pressed={dietary.includes(tag)}
              className={cn(
                "shrink-0 rounded-full border px-3 py-1.5 text-sm font-semibold transition active:scale-95",
                dietary.includes(tag)
                  ? "border-rose-deep bg-blush-soft text-ink"
                  : "border-line bg-white text-ink hover:border-rose",
              )}
            >
              {dietaryMeta[tag].label}
            </button>
          ))}
        </div>
      )}
      {initialDietary.length > 0 && (
        <p className="mt-2 text-xs text-muted">
          Showing your saved dietary preferences. Tap a chip to change what you see.
        </p>
      )}
      <p className="mt-3 text-sm text-muted">
        Many treats can be made to suit dietary needs. Filter to browse what already fits, or add a
        note with your order.
      </p>

      {/* Searching or filtering rewrites the rails silently, so say what changed.
          Rendered outside the branches below so the region is already there when
          its text updates, which is what makes it announce. */}
      <p className="sr-only" role="status" aria-live="polite">
        {matchCount === 0
          ? "No treats match that search."
          : `${matchCount} ${matchCount === 1 ? "treat" : "treats"} match your search.`}
      </p>

      {sections.length === 0 ? (
        <div className="mt-16 flex flex-col items-center gap-4 text-center">
          <MascotSays lines={["Hmm, nothing matches that. I might still bake it though!"]} />
          <p className="text-muted">No treats match that search.</p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setCategory("All");
                setDietary([]);
              }}
              className="rounded-full border border-line bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:border-rose active:scale-95"
            >
              Clear search &amp; filters
            </button>
            <Link
              href="/contact"
              className="text-sm font-semibold text-rose-ink transition hover:text-rose"
            >
              Michelle takes requests →
            </Link>
          </div>
        </div>
      ) : (
        <div
          key={`${category}|${dietary.join(",")}`}
          className="mt-8 flex animate-[fade-up_0.4s_ease-out] flex-col gap-10"
        >
          {sections.map((section) => (
            <section key={section.cat} aria-label={section.cat}>
              <h2 className="font-display text-3xl font-semibold">{section.cat}</h2>
              <div className="mt-4">
                <ProductRail label={section.cat} products={section.items} ratings={ratings} />
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
