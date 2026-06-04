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
};
