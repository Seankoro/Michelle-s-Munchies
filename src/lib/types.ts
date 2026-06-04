// Domain types shared across the app. These mirror the Supabase schema in
// supabase/migrations/0001_init.sql but use camelCase for the UI layer.

export type Allergen =
  | "peanuts"
  | "tree_nuts"
  | "gluten"
  | "dairy"
  | "eggs"
  | "soy"
  | "sesame";

export type DietaryTag =
  | "eggless"
  | "vegetarian"
  | "no_pork_no_lard"
  | "nut_free"
  | "vegan"
  | "dairy_free"
  | "gluten_free";

export type ProductOptionValue = {
  id: string;
  label: string;
  priceDeltaCents: number;
  /** Defaults to available when omitted. */
  isAvailable?: boolean;
};

export type ProductOption = {
  id: string;
  name: string;
  required: boolean;
  values: ProductOptionValue[];
};

/**
 * Per-item build-your-own box. Lets a customer pick `count` flavours of this one
 * product for a flat price, chosen from the values of the option named
 * `flavourOption`. Referenced by name, since the flavour editor regenerates
 * option ids on each save. Null or absent means the item is not sold this way.
 * This is distinct from a Build a Box template, which mixes different products.
 */
export type FlavourBoxSize = { label: string; count: number; priceCents: number };
export type FlavourBoxConfig = { flavourOption: string; sizes: FlavourBoxSize[] };

export type Product = {
  id: string;
  slug: string;
  name: string;
  shortDescription: string;
  longDescription: string;
  basePriceCents: number;
  category: string;
  isAvailable: boolean;
  isBestSeller: boolean;
  isRecommended: boolean;
  allergens: Allergen[];
  dietaryTags: DietaryTag[];
  ingredients?: string[];
  storageInfo?: string;
  servingInfo?: string;
  /** Public URLs of uploaded product photos. Empty shows the placeholder. */
  imageUrls?: string[];
  /** Remaining stock. null or undefined means untracked and unlimited. Auto sold-out at 0. */
  stockCount?: number | null;
  /** Seasonal-drop go-live time as an ISO string. A future time means not yet orderable. */
  availableFrom?: string | null;
  /** Number of placeholder photo slots to show in the detail gallery. */
  photoCount?: number;
  options: ProductOption[];
  /** Per-item build-your-own box config. null or absent means not offered. */
  flavourBox?: FlavourBoxConfig | null;
};

/** A curated set menu sold as a single cart line. */
export type BundleItem = {
  productId: string | null;
  productName: string;
  quantity: number;
};

export type Bundle = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  priceCents: number;
  imageUrl: string | null;
  items: BundleItem[];
};

/** A build-your-own box template. Pick exactly `itemCount` from `eligibleProducts`. */
export type BoxTemplate = {
  id: string;
  name: string;
  slug: string;
  itemCount: number;
  priceCents: number;
  eligibleProducts: Product[];
};

/** A customer's answer to an admin-defined structured note prompt. */
export type NoteAnswer = {
  id: string;
  label: string;
  answer: string;
};

/** A single chosen option on a cart line, snapshotted for display. */
export type SelectedOption = {
  optionName: string;
  valueLabel: string;
  priceDeltaCents: number;
};

export type CartItem = {
  /** Stable identity = product + the exact options chosen, so two sizes are two lines. */
  key: string;
  productId: string;
  slug: string;
  name: string;
  /** Base price + chosen option deltas, per unit. */
  unitPriceCents: number;
  quantity: number;
  selectedOptions: SelectedOption[];
};
