import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { geocodePostal, driveDistanceMeters } from "@/lib/onemap";
import { haversineKm, type LatLng } from "@/lib/geo";
import { sectorCentre } from "@/lib/sg-postal-sectors";

const DEFAULT_ROAD_FACTOR = 1.4;

type CacheRow = {
  delivery_postal: string;
  kitchen_postal: string;
  distance_m: number;
  delivery_lat: number | null;
  delivery_lng: number | null;
};

async function readCache(deliveryPostal: string, kitchenPostal: string): Promise<CacheRow | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("delivery_distance_cache")
    .select("delivery_postal, kitchen_postal, distance_m, delivery_lat, delivery_lng")
    .eq("delivery_postal", deliveryPostal)
    .eq("kitchen_postal", kitchenPostal)
    .maybeSingle();
  return (data as CacheRow) ?? null;
}

async function writeCache(row: CacheRow): Promise<void> {
  const admin = createAdminClient();
  await admin.from("delivery_distance_cache").upsert(row);
}

/** Pure median of a number list, or null when empty. */
export function medianOf(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Self-calibrating road factor: median of driving/straight-line across cached
 *  rows for this kitchen, or the 1.4 default until there are enough samples. */
export async function roadFactor(kitchen: { lat: number; lng: number; postal: string }): Promise<number> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("delivery_distance_cache")
    .select("distance_m, delivery_lat, delivery_lng")
    .eq("kitchen_postal", kitchen.postal);
  const rows = (data ?? []) as {
    distance_m: number;
    delivery_lat: number | null;
    delivery_lng: number | null;
  }[];
  const ratios: number[] = [];
  for (const r of rows) {
    if (r.delivery_lat == null || r.delivery_lng == null) continue;
    const straight = haversineKm(
      { lat: kitchen.lat, lng: kitchen.lng },
      { lat: r.delivery_lat, lng: r.delivery_lng },
    );
    if (straight > 0.05) ratios.push(r.distance_m / 1000 / straight);
  }
  const m = ratios.length >= 20 ? medianOf(ratios) : null;
  return m ?? DEFAULT_ROAD_FACTOR;
}

/** Distance in km from the kitchen to a delivery postal code, or null. */
export async function resolveDeliveryDistanceKm(
  deliveryPostal: string,
  kitchen: { postal: string; lat: number; lng: number },
): Promise<number | null> {
  const cached = await readCache(deliveryPostal, kitchen.postal);
  if (cached) return cached.distance_m / 1000;

  const dest = await geocodePostal(deliveryPostal);
  if (dest) {
    const meters = await driveDistanceMeters({ lat: kitchen.lat, lng: kitchen.lng }, dest);
    if (meters != null) {
      await writeCache({
        delivery_postal: deliveryPostal,
        kitchen_postal: kitchen.postal,
        distance_m: Math.round(meters),
        delivery_lat: dest.lat,
        delivery_lng: dest.lng,
      });
      return meters / 1000;
    }
  }

  const centre: LatLng | null = sectorCentre(deliveryPostal);
  if (centre) {
    const factor = await roadFactor(kitchen);
    return haversineKm({ lat: kitchen.lat, lng: kitchen.lng }, centre) * factor;
  }
  return null;
}
