export type DistanceTier = { upToKm: number; feeCents: number };

/** Fee for a resolved distance. Ordered tiers, last band covers anything
 *  beyond it. A null distance or empty tiers use the fallback flat fee. */
export function feeForDistanceKm(
  km: number | null,
  tiers: DistanceTier[],
  fallbackFeeCents: number,
): number {
  if (km == null || tiers.length === 0) return fallbackFeeCents;
  const sorted = [...tiers].sort((a, b) => a.upToKm - b.upToKm);
  const band = sorted.find((t) => km <= t.upToKm);
  return band ? band.feeCents : sorted[sorted.length - 1].feeCents;
}

export function computeZonedDeliveryFeeCents(input: {
  fulfillment: "pickup" | "delivery";
  subtotalCents: number;
  distanceKm: number | null;
  tiers: DistanceTier[];
  fallbackFeeCents: number;
  freeDeliveryMinCents: number | null;
}): number {
  if (input.fulfillment === "pickup") return 0;
  if (input.freeDeliveryMinCents != null && input.subtotalCents >= input.freeDeliveryMinCents) {
    return 0;
  }
  return feeForDistanceKm(input.distanceKm, input.tiers, input.fallbackFeeCents);
}
