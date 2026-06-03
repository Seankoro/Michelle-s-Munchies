import { createBrowserSupabase } from "@/lib/supabase/browser";
import type { NotePrompt } from "@/lib/settings";

// Raw public `settings` row read from the browser. The cart and checkout pages
// both need (overlapping) settings client-side; this centralises the query +
// shape so the column list isn't duplicated. (`NotePrompt` is a type-only import,
// erased at build, so it doesn't pull the server-only settings module client-side.)
export type ClientSettingsRow = {
  delivery_fee_cents: number | null;
  free_delivery_min_cents: number | null;
  min_order_cents: number | null;
  lead_time_days: number | null;
  time_windows: string[] | null;
  blackout_dates: string[] | null;
  pickup_location_public: string | null;
  daily_order_cap: number | null;
  daily_cutoff_time: string | null;
  note_prompts: NotePrompt[] | null;
  point_value_cents: number | null;
  free_gift_threshold_cents: number | null;
  free_gift_product_id: string | null;
};

const SETTINGS_SELECT =
  "delivery_fee_cents, free_delivery_min_cents, min_order_cents, lead_time_days, time_windows, blackout_dates, pickup_location_public, daily_order_cap, daily_cutoff_time, note_prompts, point_value_cents, free_gift_threshold_cents, free_gift_product_id";

/** Read the public settings row (id=1) from the browser. Null when missing. */
export async function fetchClientSettingsRow(): Promise<ClientSettingsRow | null> {
  const supabase = createBrowserSupabase();
  const { data } = await supabase.from("settings").select(SETTINGS_SELECT).eq("id", 1).maybeSingle();
  return (data as ClientSettingsRow | null) ?? null;
}
