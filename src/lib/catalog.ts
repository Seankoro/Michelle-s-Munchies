import type { Allergen, DietaryTag } from "@/lib/types";

// ---------------------------------------------------------------------------
// Display metadata for allergens & dietary tags
// ---------------------------------------------------------------------------
export const allergenMeta: Record<Allergen, { icon: string; label: string }> = {
  peanuts: { icon: "🥜", label: "Peanuts" },
  tree_nuts: { icon: "🌰", label: "Tree nuts" },
  gluten: { icon: "🌾", label: "Gluten" },
  dairy: { icon: "🥛", label: "Dairy" },
  eggs: { icon: "🥚", label: "Eggs" },
  soy: { icon: "🫛", label: "Soy" },
  sesame: { icon: "⚪", label: "Sesame" },
};

export const dietaryMeta: Record<DietaryTag, { label: string }> = {
  eggless: { label: "Eggless" },
  vegetarian: { label: "Vegetarian" },
  no_pork_no_lard: { label: "No Pork / No Lard" },
  nut_free: { label: "Nut-free" },
  vegan: { label: "Vegan" },
  dairy_free: { label: "Dairy-free" },
  gluten_free: { label: "Gluten-free" },
};

/** Format integer cents as Singapore dollars, e.g. 1200 -> "S$12.00". */
export function formatPrice(cents: number): string {
  return `S$${(cents / 100).toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// Fallback store-settings defaults. The live `settings` row read through
// src/lib/settings.ts is the source of truth. These only fill missing values.
// ---------------------------------------------------------------------------
export const mockSettings = {
  deliveryFeeCents: 800,
  freeDeliveryMinCents: 5000,
  minOrderCents: 0,
  leadTimeDays: 2,
  timeWindows: ["Morning (9am–12pm)", "Afternoon (12–4pm)", "Evening (4–8pm)"],
  blackoutDates: ["2026-06-10"],
  pickupLocation: "Tampines, Singapore (exact address sent after you order)",
};
