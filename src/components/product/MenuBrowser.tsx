"use client";

import { useMemo, useState } from "react";
import type { DietaryTag, Product } from "@/lib/types";
import { dietaryMeta } from "@/lib/catalog";
import { ProductCard } from "@/components/product/ProductCard";
import { cn } from "@/lib/cn";

/**
 * One category's products as a horizontal scroll-snap rail on phones and tablets,
 * so the menu reads as short swipeable rows instead of one long vertical list, and
 * a plain grid on desktop. Pure CSS, no JS needed.
 */
function ProductRail({ products }: { products: Product[] }) {
  return (
    <div
      className={cn(
        "-mx-6 flex gap-4 overflow-x-auto scroll-pl-6 px-6 pb-2 snap-x snap-mandatory no-scrollbar",
        "xl:mx-0 xl:grid xl:grid-cols-4 xl:gap-6 xl:overflow-visible xl:px-0 xl:pb-0 xl:snap-none",
      )}
    >
      {products.map((product) => (
        <div
          key={product.id}
          className="shrink-0 basis-[72%] snap-start sm:basis-[40%] lg:basis-[31%] xl:basis-auto"
        >
          <ProductCard product={product} />
        </div>
      ))}
    </div>
  );
}

export function MenuBrowser({
  products,
  categories,
  initialDietary = [],
}: {
  products: Product[];
  categories: string[];
  initialDietary?: DietaryTag[];
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [dietary, setDietary] = useState<DietaryTag[]>(initialDietary);

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
        product.category.toLowerCase().includes(q);
      const matchesDietary = dietary.every((tag) => product.dietaryTags.includes(tag));
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
            className="w-full rounded-full border border-line bg-white px-4 py-2 text-sm outline-none transition focus:border-rose"
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
                  ? "border-sky-deep bg-sky/50 text-sky-deep"
                  : "border-line bg-white text-ink hover:border-sky",
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

      {sections.length === 0 ? (
        <p className="mt-16 text-center text-muted">
          No treats match that search. Try something else?
        </p>
      ) : (
        <div
          key={`${category}|${dietary.join(",")}`}
          className="mt-8 flex animate-[fade-up_0.4s_ease-out] flex-col gap-10"
        >
          {sections.map((section) => (
            <section key={section.cat} aria-label={section.cat}>
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="font-display text-2xl font-semibold">{section.cat}</h2>
                {section.items.length > 1 && (
                  <span className="text-sm text-rose xl:hidden">Swipe →</span>
                )}
              </div>
              <div className="mt-4">
                <ProductRail products={section.items} />
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
