import "server-only";
import { computeDeliveryFeeCents } from "@/lib/order";
import type { fetchStoreSettings } from "@/lib/settings";
import { fetchDeliveryConfig, type DeliveryConfig } from "@/lib/delivery-config";
import { resolveDeliveryDistanceKm } from "@/lib/delivery-distance";
import { computeZonedDeliveryFeeCents } from "@/lib/delivery-fee";

/** Distance pricing is on only with tiers and a located kitchen. Otherwise every
 *  delivery pays the flat fee from settings. */
function zonesReady(config: DeliveryConfig): boolean {
  return (
    config.tiers.length > 0 &&
    config.kitchenPostal != null &&
    config.kitchenLat != null &&
    config.kitchenLng != null
  );
}

/**
 * How delivery is priced, for wording shown to shoppers (the FAQ and the
 * checkout's delivery option). The cheapest band when distance pricing is on,
 * null when it is a flat fee. Only tier fees leave here, never the kitchen
 * location.
 */
export async function fetchZonedFromCents(): Promise<number | null> {
  const config = await fetchDeliveryConfig();
  return zonesReady(config) ? Math.min(...config.tiers.map((t) => t.feeCents)) : null;
}

/**
 * Delivery fee, authoritative and shared by online checkout (placeOrder + the
 * estimate action) and admin manual orders, so an address prices the same
 * everywhere. Distance-zoned when the kitchen origin and tiers are configured,
 * otherwise the existing flat fee from settings. Never trusts a client-sent fee,
 * it always recomputes from the server-only delivery config.
 */
export async function resolveDeliveryFeeCents(
  fulfillment: "pickup" | "delivery",
  subtotalCents: number,
  postalCode: string | undefined,
  settings: Awaited<ReturnType<typeof fetchStoreSettings>>,
): Promise<number> {
  if (fulfillment === "delivery" && postalCode && /^\d{6}$/.test(postalCode)) {
    // Kitchen origin + tiers are server-only (delivery_config), never on the
    // public settings row, because the coordinates are the owner's address.
    const config = await fetchDeliveryConfig();
    if (zonesReady(config)) {
      const km = await resolveDeliveryDistanceKm(postalCode, {
        postal: config.kitchenPostal!,
        lat: config.kitchenLat!,
        lng: config.kitchenLng!,
      });
      return computeZonedDeliveryFeeCents({
        fulfillment,
        subtotalCents,
        distanceKm: km,
        tiers: config.tiers,
        fallbackFeeCents: settings.deliveryFeeCents,
        freeDeliveryMinCents: settings.freeDeliveryMinCents,
      });
    }
  }
  // Not configured, or pickup: keep the existing flat behaviour.
  return computeDeliveryFeeCents(subtotalCents, fulfillment, settings);
}
