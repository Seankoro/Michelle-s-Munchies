import "server-only";
import { createPublicClient } from "@/lib/supabase/public";
import { mockSettings } from "@/lib/catalog";
import { ALL_FEATURES_ON, type FeatureFlags } from "@/lib/feature-flags";

// Re-exported so existing `import { FeatureFlags } from "@/lib/settings"` callers
// keep working; the canonical definition lives in feature-flags.ts.
export { ALL_FEATURES_ON };
export type { FeatureFlags };

/** A single admin-defined structured order-note prompt shown at checkout. */
export type NotePrompt = {
  id: string;
  label: string;
  type: "text" | "boolean";
  required: boolean;
};

/**
 * Live storefront settings, read from the `settings` row Michelle edits in the
 * admin. `mockSettings` (in catalog.ts) is now only the *fallback default* used
 * when a value is missing — the database is the source of truth.
 */
export type StoreSettings = {
  deliveryFeeCents: number;
  freeDeliveryMinCents: number;
  minOrderCents: number;
  leadTimeDays: number;
  timeWindows: string[];
  blackoutDates: string[];
  pickupLocation: string;
  /** null = unlimited. */
  dailyOrderCap: number | null;
  /** Max non-cancelled orders per (date, time window). null = unlimited. */
  perWindowCap: number | null;
  /** Same-day order cutoff as "HH:MM" (or "HH:MM:SS"). null = no cutoff. */
  dailyCutoffTime: string | null;
  /** Free-gift spend nudge: threshold + the gift product. null = off. */
  freeGiftThresholdCents: number | null;
  freeGiftProductId: string | null;
  birthdayRewardPoints: number;
  abandonedAfterHours: number;
  notePrompts: NotePrompt[];
  /** Email Michelle when a tracked product's stock falls to/below this. null = off. */
  lowStockThreshold: number | null;
  features: FeatureFlags;
};

type SettingsRow = {
  delivery_fee_cents: number | null;
  free_delivery_min_cents: number | null;
  min_order_cents: number | null;
  lead_time_days: number | null;
  time_windows: string[] | null;
  blackout_dates: string[] | null;
  pickup_location_public: string | null;
  daily_order_cap: number | null;
  per_window_cap: number | null;
  daily_cutoff_time: string | null;
  free_gift_threshold_cents: number | null;
  free_gift_product_id: string | null;
  birthday_reward_points: number | null;
  abandoned_after_hours: number | null;
  note_prompts: NotePrompt[] | null;
  low_stock_threshold: number | null;
  feature_order_changes: boolean | null;
  feature_newsletter: boolean | null;
  feature_drops: boolean | null;
  feature_dietary_prefs: boolean | null;
  feature_rewards: boolean | null;
  feature_wishlist: boolean | null;
  feature_reviews: boolean | null;
  feature_promos: boolean | null;
  feature_gifting: boolean | null;
  feature_referrals: boolean | null;
  feature_build_a_box: boolean | null;
  feature_bundles: boolean | null;
  feature_spend_gift: boolean | null;
  feature_back_in_stock: boolean | null;
  feature_photo_reviews: boolean | null;
  feature_cart_sharing: boolean | null;
  feature_wishlist_sharing: boolean | null;
  feature_instagram_feed: boolean | null;
  feature_birthday_rewards: boolean | null;
  feature_abandoned_cart: boolean | null;
  feature_structured_notes: boolean | null;
};

export const SETTINGS_SELECT =
  "delivery_fee_cents, free_delivery_min_cents, min_order_cents, lead_time_days, time_windows, blackout_dates, pickup_location_public, daily_order_cap, per_window_cap, daily_cutoff_time, free_gift_threshold_cents, free_gift_product_id, birthday_reward_points, abandoned_after_hours, note_prompts, low_stock_threshold, feature_rewards, feature_wishlist, feature_reviews, feature_promos, feature_gifting, feature_referrals, feature_build_a_box, feature_bundles, feature_spend_gift, feature_back_in_stock, feature_photo_reviews, feature_cart_sharing, feature_wishlist_sharing, feature_instagram_feed, feature_birthday_rewards, feature_abandoned_cart, feature_structured_notes, feature_order_changes, feature_newsletter, feature_drops, feature_dietary_prefs";

const DEFAULTS: StoreSettings = {
  ...mockSettings,
  dailyOrderCap: null,
  perWindowCap: null,
  dailyCutoffTime: null,
  freeGiftThresholdCents: null,
  freeGiftProductId: null,
  birthdayRewardPoints: 0,
  abandonedAfterHours: 4,
  notePrompts: [],
  lowStockThreshold: null,
  features: { ...ALL_FEATURES_ON },
};

/** Map a raw settings row (or null) to StoreSettings, filling gaps with defaults. */
export function rowToStoreSettings(row: SettingsRow | null): StoreSettings {
  if (!row) return DEFAULTS;
  return {
    deliveryFeeCents: row.delivery_fee_cents ?? DEFAULTS.deliveryFeeCents,
    freeDeliveryMinCents: row.free_delivery_min_cents ?? DEFAULTS.freeDeliveryMinCents,
    minOrderCents: row.min_order_cents ?? DEFAULTS.minOrderCents,
    leadTimeDays: row.lead_time_days ?? DEFAULTS.leadTimeDays,
    timeWindows:
      row.time_windows && row.time_windows.length > 0 ? row.time_windows : DEFAULTS.timeWindows,
    blackoutDates: row.blackout_dates ?? DEFAULTS.blackoutDates,
    pickupLocation: row.pickup_location_public || DEFAULTS.pickupLocation,
    dailyOrderCap: row.daily_order_cap,
    perWindowCap: row.per_window_cap,
    dailyCutoffTime: row.daily_cutoff_time,
    freeGiftThresholdCents: row.free_gift_threshold_cents,
    freeGiftProductId: row.free_gift_product_id,
    birthdayRewardPoints: row.birthday_reward_points ?? 0,
    abandonedAfterHours: row.abandoned_after_hours ?? 4,
    notePrompts: Array.isArray(row.note_prompts) ? row.note_prompts : [],
    lowStockThreshold: row.low_stock_threshold,
    features: {
      rewards: row.feature_rewards ?? true,
      wishlist: row.feature_wishlist ?? true,
      reviews: row.feature_reviews ?? true,
      promos: row.feature_promos ?? true,
      gifting: row.feature_gifting ?? true,
      referrals: row.feature_referrals ?? true,
      buildABox: row.feature_build_a_box ?? true,
      bundles: row.feature_bundles ?? true,
      spendGift: row.feature_spend_gift ?? true,
      backInStock: row.feature_back_in_stock ?? true,
      photoReviews: row.feature_photo_reviews ?? true,
      cartSharing: row.feature_cart_sharing ?? true,
      wishlistSharing: row.feature_wishlist_sharing ?? true,
      instagram: row.feature_instagram_feed ?? true,
      birthdayRewards: row.feature_birthday_rewards ?? true,
      abandonedCart: row.feature_abandoned_cart ?? true,
      structuredNotes: row.feature_structured_notes ?? true,
      orderChanges: row.feature_order_changes ?? true,
      newsletter: row.feature_newsletter ?? true,
      drops: row.feature_drops ?? true,
      dietaryPrefs: row.feature_dietary_prefs ?? true,
    },
  };
}

/** Live settings for server-side use (order creation, validation, SSR display). */
export async function fetchStoreSettings(): Promise<StoreSettings> {
  const supabase = createPublicClient();
  const { data } = await supabase
    .from("settings")
    .select(SETTINGS_SELECT)
    .eq("id", 1)
    .maybeSingle();
  return rowToStoreSettings(data as SettingsRow | null);
}

/** Just the feature flags (for the layout/provider). */
export async function fetchFeatureFlags(): Promise<FeatureFlags> {
  return (await fetchStoreSettings()).features;
}
