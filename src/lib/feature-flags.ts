// Client-safe with no "server-only" import. The single source of truth for the
// feature-flag shape and its all-on default. Both the server settings layer in
// settings.ts and the client provider in FeaturesProvider import from here, so
// they can never drift.

/** Owner-controllable feature toggles, surfaced in Admin under Settings then Features. */
export type FeatureFlags = {
  // Original six
  rewards: boolean;
  wishlist: boolean;
  reviews: boolean;
  promos: boolean;
  gifting: boolean;
  referrals: boolean;
  // Storefront-enhancements batch
  buildABox: boolean;
  bundles: boolean;
  spendGift: boolean;
  backInStock: boolean;
  photoReviews: boolean;
  cartSharing: boolean;
  wishlistSharing: boolean;
  instagram: boolean;
  birthdayRewards: boolean;
  abandonedCart: boolean;
  structuredNotes: boolean;
  // Owner-ops & engagement batch
  orderChanges: boolean;
  newsletter: boolean;
  drops: boolean;
  dietaryPrefs: boolean;
  occasionReminders: boolean;
};

export const ALL_FEATURES_ON: FeatureFlags = {
  rewards: true,
  wishlist: true,
  reviews: true,
  promos: true,
  gifting: true,
  referrals: true,
  buildABox: true,
  bundles: true,
  spendGift: true,
  backInStock: true,
  photoReviews: true,
  cartSharing: true,
  wishlistSharing: true,
  instagram: true,
  birthdayRewards: true,
  abandonedCart: true,
  structuredNotes: true,
  orderChanges: true,
  newsletter: true,
  drops: true,
  dietaryPrefs: true,
  occasionReminders: true,
};

/**
 * The DB column for each flag, in one place so the settings SELECT and the two
 * row-to-flags mappers can't drift (a missing column here is exactly what once
 * left a toggle silently ignored). Add a flag in exactly one spot: here.
 */
export const FEATURE_COLUMNS: readonly (readonly [column: string, flag: keyof FeatureFlags])[] = [
  ["feature_rewards", "rewards"],
  ["feature_wishlist", "wishlist"],
  ["feature_reviews", "reviews"],
  ["feature_promos", "promos"],
  ["feature_gifting", "gifting"],
  ["feature_referrals", "referrals"],
  ["feature_build_a_box", "buildABox"],
  ["feature_bundles", "bundles"],
  ["feature_spend_gift", "spendGift"],
  ["feature_back_in_stock", "backInStock"],
  ["feature_photo_reviews", "photoReviews"],
  ["feature_cart_sharing", "cartSharing"],
  ["feature_wishlist_sharing", "wishlistSharing"],
  ["feature_instagram_feed", "instagram"],
  ["feature_birthday_rewards", "birthdayRewards"],
  ["feature_abandoned_cart", "abandonedCart"],
  ["feature_structured_notes", "structuredNotes"],
  ["feature_order_changes", "orderChanges"],
  ["feature_newsletter", "newsletter"],
  ["feature_drops", "drops"],
  ["feature_dietary_prefs", "dietaryPrefs"],
  ["feature_occasion_reminders", "occasionReminders"],
];

/** The comma-joined feature columns for a settings SELECT. */
export const FEATURE_COLUMNS_SELECT = FEATURE_COLUMNS.map(([column]) => column).join(", ");

/** Map a settings row's feature_* columns to flags, each defaulting to on. */
export function rowToFeatureFlags(row: Record<string, boolean | null | undefined>): FeatureFlags {
  const flags = {} as FeatureFlags;
  for (const [column, flag] of FEATURE_COLUMNS) flags[flag] = row[column] ?? true;
  return flags;
}
