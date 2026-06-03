import "server-only";
import { headers } from "next/headers";

/**
 * Rate limiter for custom Server Actions (Supabase already throttles its own
 * auth endpoints). Keyed by client IP + action.
 *
 * Two backends, chosen automatically:
 *
 *  - Upstash Redis (REST) when UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
 *    are set. This gives a SHARED counter across every serverless instance, which
 *    is what you want on Vercel where each request can hit a fresh worker.
 *  - In-memory otherwise — effective in dev and single-instance hosting, and the
 *    automatic fallback if an Upstash call ever fails (so a Redis blip can't take
 *    the site down). In-memory limits are per-instance only.
 *
 * We talk to Upstash over its REST API with plain fetch to avoid adding a
 * dependency — same approach as the Twilio module in sms.ts.
 */
type Hit = { count: number; resetAt: number };
const buckets = new Map<string, Hit>();

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const upstashReady = Boolean(UPSTASH_URL && UPSTASH_TOKEN);

async function clientIp(): Promise<string> {
  const h = await headers();
  const fwd = h.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return h.get("x-real-ip") ?? "local";
}

/** Per-instance fixed-window counter. Also the fallback when Upstash is down. */
function inMemoryAllow(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();

  // Opportunistic prune so the map can't grow unbounded.
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) if (now > v.resetAt) buckets.delete(k);
  }

  const hit = buckets.get(key);
  if (!hit || now > hit.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (hit.count >= limit) return false;
  hit.count += 1;
  return true;
}

/**
 * Shared fixed-window counter in Redis. INCR returns the new count; PEXPIRE with
 * NX sets the window's TTL only on the first hit, so the window doesn't slide
 * forward on every request. Both run in one pipeline round-trip.
 */
async function upstashAllow(key: string, limit: number, windowMs: number): Promise<boolean> {
  const res = await fetch(`${UPSTASH_URL}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${UPSTASH_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([
      ["INCR", key],
      ["PEXPIRE", key, windowMs, "NX"],
    ]),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Upstash responded ${res.status}`);
  const data = (await res.json()) as Array<{ result?: number; error?: string }>;
  const count = data[0]?.result;
  if (typeof count !== "number") throw new Error("Upstash returned a malformed response");
  return count <= limit;
}

/** Returns true if the request is allowed, false if it exceeds the limit. */
export async function rateLimit(
  action: string,
  opts: { limit: number; windowMs: number },
): Promise<boolean> {
  const key = `rl:${action}:${await clientIp()}`;

  if (upstashReady) {
    try {
      return await upstashAllow(key, opts.limit, opts.windowMs);
    } catch (error) {
      // Never let a Redis hiccup break a user action — fall back to the
      // in-memory limiter, which still bounds traffic on this instance.
      console.error("[rate-limit] Upstash unavailable, using in-memory fallback:", error);
    }
  }

  return inMemoryAllow(key, opts.limit, opts.windowMs);
}
