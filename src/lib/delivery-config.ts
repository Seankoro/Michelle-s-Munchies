import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { DistanceTier } from "@/lib/delivery-fee";

export type DeliveryConfig = {
  kitchenPostal: string | null;
  kitchenLat: number | null;
  kitchenLng: number | null;
  tiers: DistanceTier[];
};

export async function fetchDeliveryConfig(): Promise<DeliveryConfig> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("delivery_config")
    .select("kitchen_postal, kitchen_lat, kitchen_lng, distance_tiers")
    .eq("id", 1)
    .maybeSingle();
  const row = (data ?? {}) as {
    kitchen_postal?: string | null;
    kitchen_lat?: number | null;
    kitchen_lng?: number | null;
    distance_tiers?: unknown;
  };
  return {
    kitchenPostal: row.kitchen_postal ?? null,
    kitchenLat: row.kitchen_lat ?? null,
    kitchenLng: row.kitchen_lng ?? null,
    tiers: Array.isArray(row.distance_tiers)
      ? (row.distance_tiers as DistanceTier[]).filter(
          (t) => t && typeof t.upToKm === "number" && typeof t.feeCents === "number",
        )
      : [],
  };
}

export async function updateDeliveryConfig(
  patch: Partial<{
    kitchenPostal: string | null;
    kitchenLat: number | null;
    kitchenLng: number | null;
    tiers: DistanceTier[];
  }>,
): Promise<void> {
  const admin = createAdminClient();
  const columns: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.kitchenPostal !== undefined) columns.kitchen_postal = patch.kitchenPostal;
  if (patch.kitchenLat !== undefined) columns.kitchen_lat = patch.kitchenLat;
  if (patch.kitchenLng !== undefined) columns.kitchen_lng = patch.kitchenLng;
  if (patch.tiers !== undefined) columns.distance_tiers = patch.tiers;
  await admin.from("delivery_config").update(columns).eq("id", 1);
}
