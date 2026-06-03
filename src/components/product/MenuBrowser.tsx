"use client";

import { useMemo, useState } from "react";
import type { DietaryTag, Product } from "@/lib/types";
import { dietaryMeta } from "@/lib/catalog";
import { ProductCard } from "@/components/product/ProductCard";
import { cn } from "@/lib/cn";

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
    () => (Object.keys(dietaryMeta) as DietaryTag[]).filter((tag) =>
      products.some((p) => p.dietaryTags.includes(tag)),
    ),
    [products],
  );

  function toggleDietary(tag: DietaryTag) {
    setDietary((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter((product) => {
      const matchesCategory = category === "All" || product.category === category;
      const matchesQuery =
        !q ||
        product.name.toLowerCase().includes(q) ||
        product.shortDescription.toLowerCase().includes(q) ||
        product.category.toLowerCase().includes(q);
      const matchesDietary = dietary.every((tag) => product.dietaryTags.includes(tag));
      return matchesCategory && matchesQuery && matchesDietary;
    });
  }, [products, query, category, dietary]);

  const allCategories = ["All", ...categories];

  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by category">
          {allCategories.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setCategory(option)}
              aria-pressed={category === option}
              className={cn(
                "rounded-full border px-4 py-2 text-sm font-semibold transition active:scale-95",
                category === option
                  ? "border-rose-deep bg-blush-soft text-rose-deep"
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
        <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label="Filter by dietary need">
          <span className="text-sm font-semibold text-muted">Dietary:</span>
          {dietaryTags.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => toggleDietary(tag)}
              aria-pressed={dietary.includes(tag)}
              className={cn(
                "rounded-full border px-3 py-1.5 text-sm font-semibold transition active:scale-95",
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

      {filtered.length === 0 ? (
        <p className="mt-16 text-center text-muted">
          No treats match that search. Try something else?
        </p>
      ) : (
        <div
          key={`${category}|${dietary.join(",")}`}
          className="mt-8 grid animate-[fade-up_0.4s_ease-out] gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5"
        >
          {filtered.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      )}
    </div>
  );
}
