import type { LatLng } from "@/lib/geo";

/** First-two-digits postal sector -> representative centre (WGS84).
 *  Built once from OneMap geocodes of a representative postal per sector.
 *  TODO: Complete the full ~60-sector table. Missing sectors return null. */
const SECTOR_CENTRES: Record<string, LatLng> = {
  "01": { lat: 1.2811, lng: 103.8506 },
  "02": { lat: 1.2792, lng: 103.8480 },
  "03": { lat: 1.2839, lng: 103.8540 },
  "04": { lat: 1.2867, lng: 103.8507 },
  "05": { lat: 1.2948, lng: 103.8505 },
  "06": { lat: 1.3076, lng: 103.8558 },
  "07": { lat: 1.3132, lng: 103.8392 },
  "08": { lat: 1.3087, lng: 103.8721 },
  "09": { lat: 1.3195, lng: 103.8960 },
  "10": { lat: 1.3355, lng: 103.9074 },
  "14": { lat: 1.3241, lng: 103.9602 },
  "15": { lat: 1.3359, lng: 103.9445 },
  "19": { lat: 1.4117, lng: 103.8617 },
  "20": { lat: 1.4205, lng: 103.8458 },
  "28": { lat: 1.3521, lng: 103.8365 },
  "29": { lat: 1.3697, lng: 103.8441 },
  "30": { lat: 1.3566, lng: 103.8153 },
  "31": { lat: 1.3822, lng: 103.7610 },
  "32": { lat: 1.3926, lng: 103.7799 },
  "33": { lat: 1.3701, lng: 103.7459 },
  "39": { lat: 1.3437, lng: 103.7246 },
  "40": { lat: 1.3553, lng: 103.6986 },
  "45": { lat: 1.3923, lng: 103.7352 },
  "46": { lat: 1.4014, lng: 103.7501 },
  "48": { lat: 1.3791, lng: 103.7234 },
  "50": { lat: 1.2900, lng: 103.7456 },
  "54": { lat: 1.3716, lng: 103.8883 },
  "55": { lat: 1.3948, lng: 103.9016 },
  "60": { lat: 1.3315, lng: 103.7018 },
  "65": { lat: 1.3653, lng: 103.7071 },
  "66": { lat: 1.3779, lng: 103.6963 },
  "68": { lat: 1.3854, lng: 103.7443 },
  "69": { lat: 1.3931, lng: 103.7615 },
  "70": { lat: 1.3487, lng: 103.8159 },
  "71": { lat: 1.3613, lng: 103.8265 },
  "75": { lat: 1.4053, lng: 103.8124 },
  "76": { lat: 1.4166, lng: 103.8380 },
  "77": { lat: 1.4269, lng: 103.8236 },
  "78": { lat: 1.4333, lng: 103.8548 },
  "79": { lat: 1.4287, lng: 103.8725 },
  "80": { lat: 1.3538, lng: 103.9450 },
  "81": { lat: 1.4093, lng: 103.9302 },
  "82": { lat: 1.4197, lng: 103.9543 },
};

/** Centre of the sector a 6-digit postal code belongs to, or null. */
export function sectorCentre(postal: string): LatLng | null {
  if (!/^\d{6}$/.test(postal)) return null;
  return SECTOR_CENTRES[postal.slice(0, 2)] ?? null;
}
