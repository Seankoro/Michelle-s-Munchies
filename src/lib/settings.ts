import "server-only";
import { createPublicClient } from "@/lib/supabase/public";
import { mockSettings } from "@/lib/catalog";
import {
  ALL_FEATURES_ON,
  FEATURE_COLUMNS_SELECT,
  rowToFeatureFlags,
  type FeatureFlags,
} from "@/lib/feature-flags";

// Type re-exported so existing `import { FeatureFlags } from "@/lib/settings"`
// callers keep working. The canonical definition lives in feature-flags.ts.
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
 * admin. `mockSettings` in catalog.ts is now only the fallback default used
 * when a value is missing. The database is the source of truth.
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
  /** Max non-cancelled orders per date and time window. null = unlimited. */
  perWindowCap: number | null;
  /** Same-day order cutoff as "HH:MM" or "HH:MM:SS". null = no cutoff. */
  dailyCutoffTime: string | null;
  /** Free-gift spend nudge, the threshold and the gift product. null = off. */
  freeGiftThresholdCents: number | null;
  freeGiftProductId: string | null;
  birthdayRewardPoints: number;
  abandonedAfterHours: number;
  notePrompts: NotePrompt[];
  /** Email Michelle when a tracked product's stock falls to or below this. null = off. */
  lowStockThreshold: number | null;
  /**
   * Owner-written lines for the hero mascot's speech bubble, one per entry. These
   * are ADDED to the built-in automatic lines, never a replacement, and the
   * mascot cycles through all of them. Empty means only the automatic lines show.
   */
  mascotMessages: string[];
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
  mascot_message: string | null;
  feature_order_changes: boolean | null;
  feature_newsletter: boolean | null;
  feature_drops: boolean | null;
  feature_dietary_prefs: boolean | null;
  feature_occasion_reminders: boolean | null;
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

// Non-feature columns plus every feature_* column from the shared list, so a new
// flag added in feature-flags.ts is fetched here automatically.
export const SETTINGS_SELECT =
  "delivery_fee_cents, free_delivery_min_cents, min_order_cents, lead_time_days, time_windows, blackout_dates, pickup_location_public, daily_order_cap, per_window_cap, daily_cutoff_time, free_gift_threshold_cents, free_gift_product_id, birthday_reward_points, abandoned_after_hours, note_prompts, low_stock_threshold, mascot_message, " +
  FEATURE_COLUMNS_SELECT;

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
  mascotMessages: [],
  features: { ...ALL_FEATURES_ON },
};

/**
 * Parse the mascot-message column into a list. Stored one message per line, so
 * a single legacy message loads as a one-item list. Blank lines are dropped and
 * the count is capped so the speech bubble can't be flooded.
 */
export function parseMascotMessages(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 10);
}

/** Map a raw settings row or null to StoreSettings, filling gaps with defaults. */
function rowToStoreSettings(row: SettingsRow | null): StoreSettings {
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
    mascotMessages: parseMascotMessages(row.mascot_message),
    features: rowToFeatureFlags(row as unknown as Record<string, boolean | null | undefined>),
  };
}

/** Live settings for server-side use, like order creation, validation, and SSR display. */
export async function fetchStoreSettings(): Promise<StoreSettings> {
  const supabase = createPublicClient();
  const { data } = await supabase
    .from("settings")
    .select(SETTINGS_SELECT)
    .eq("id", 1)
    .maybeSingle();
  return rowToStoreSettings(data as SettingsRow | null);
}

/** Just the feature flags, for the layout and provider. */
export async function fetchFeatureFlags(): Promise<FeatureFlags> {
  return (await fetchStoreSettings()).features;
}
