import "server-only";
import type { LatLng } from "@/lib/geo";

const BASE = "https://www.onemap.gov.sg";
const ONEMAP_TIMEOUT_MS = 4000;
let cachedToken: { token: string; expiresAt: number } | null = null;

async function getToken(): Promise<string | null> {
  const email = process.env.ONEMAP_EMAIL;
  const password = process.env.ONEMAP_PASSWORD;
  if (!email || !password) return null;
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.token;
  try {
    const res = await fetch(`${BASE}/api/auth/post/getToken`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(ONEMAP_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { access_token?: string; expiry_timestamp?: string };
    if (!data.access_token) return null;
    const expiresAt = data.expiry_timestamp
      ? Number(data.expiry_timestamp) * 1000
      : Date.now() + 2 * 24 * 60 * 60 * 1000;
    cachedToken = { token: data.access_token, expiresAt };
    return cachedToken.token;
  } catch {
    return null;
  }
}

export async function geocodePostal(postal: string): Promise<LatLng | null> {
  const token = await getToken();
  if (!token) return null;
  try {
    const url = `${BASE}/api/common/elastic/search?searchVal=${encodeURIComponent(postal)}&returnGeom=Y&getAddrDetails=Y&pageNum=1`;
    const res = await fetch(url, {
      headers: { Authorization: token },
      signal: AbortSignal.timeout(ONEMAP_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { results?: Array<{ LATITUDE?: string; LONGITUDE?: string }> };
    const first = data.results?.[0];
    if (!first?.LATITUDE || !first?.LONGITUDE) return null;
    const lat = Number(first.LATITUDE);
    const lng = Number(first.LONGITUDE);
    if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
    return { lat, lng };
  } catch {
    return null;
  }
}

export async function driveDistanceMeters(from: LatLng, to: LatLng): Promise<number | null> {
  const token = await getToken();
  if (!token) return null;
  try {
    const url = `${BASE}/api/public/routingsvc/route?start=${from.lat},${from.lng}&end=${to.lat},${to.lng}&routeType=drive`;
    const res = await fetch(url, {
      headers: { Authorization: token },
      signal: AbortSignal.timeout(ONEMAP_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { route_summary?: { total_distance?: number } };
    const m = data.route_summary?.total_distance;
    return typeof m === "number" ? m : null;
  } catch {
    return null;
  }
}

export function __resetTokenForTests(): void {
  cachedToken = null;
}
