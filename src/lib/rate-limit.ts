import "server-only";
import { headers } from "next/headers";

/**
 * Rate limiter for custom Server Actions. Supabase already throttles its own
 * auth endpoints. Keyed by action, and by client IP unless the caller asks for
 * the "global" scope (see rateLimit below).
 *
 * Two backends, chosen automatically.
 *
 *  - Upstash Redis over REST when UPSTASH_REDIS_REST_URL and
 *    UPSTASH_REDIS_REST_TOKEN are set. This gives a shared counter across every
 *    serverless instance, which is what you want on Vercel where each request can
 *    hit a fresh worker.
 *  - In-memory otherwise, effective in dev and single-instance hosting, and the
 *    automatic fallback if an Upstash call ever fails so a Redis blip can't take
 *    the site down. In-memory limits are per-instance only.
 *
 * We talk to Upstash over its REST API with plain fetch to avoid adding a
 * dependency, same approach as the Twilio module in sms.ts.
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
 * Shared fixed-window counter in Redis. INCR returns the new count. PEXPIRE with
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
    // A Redis that answers slowly is worse than one that is plainly down. With
    // no bound this fetch waits as long as the connection stays open, and the
    // caller is a checkout or a sign-in that cannot start until it returns, so
    // the fallback written below to survive exactly this never gets to run.
    // Two seconds is far longer than a healthy round trip to the same region.
    signal: AbortSignal.timeout(2000),
  });
  if (!res.ok) throw new Error(`Upstash responded ${res.status}`);
  const data = (await res.json()) as Array<{ result?: number; error?: string }>;
  const count = data[0]?.result;
  if (typeof count !== "number") throw new Error("Upstash returned a malformed response");
  return count <= limit;
}

/**
 * Returns true if the request is allowed, false if it exceeds the limit.
 *
 * Scope picks what the counter is keyed on besides the action.
 *
 *  - "ip" (the default) counts per caller, which is what you want for ordinary
 *    "stop one visitor hammering this form" limits.
 *  - "global" leaves the IP out entirely. Callers that put an email address in
 *    the action string need this. With the IP in the key, anyone rotating their
 *    source address gets a fresh counter for every request, so the cap on how
 *    much mail one inbox can receive never actually binds.
 */
export async function rateLimit(
  action: string,
  opts: { limit: number; windowMs: number; scope?: "ip" | "global" },
): Promise<boolean> {
  const key = opts.scope === "global" ? `rl:${action}` : `rl:${action}:${await clientIp()}`;

  if (upstashReady) {
    try {
      return await upstashAllow(key, opts.limit, opts.windowMs);
    } catch (error) {
      // Never let a Redis hiccup break a user action. Fall back to the
      // in-memory limiter, which still bounds traffic on this instance.
      console.error("[rate-limit] Upstash unavailable, using in-memory fallback:", error);
    }
  } else {
    warnUnsharedInProduction();
  }

  return inMemoryAllow(key, opts.limit, opts.windowMs);
}

let warnedUnshared = false;

/**
 * Say loudly, once per instance, that the limits are not really binding.
 *
 * The in-memory fallback counts per serverless instance, and the host starts a
 * fresh instance whenever it likes, so on a real deployment a caller can simply
 * land on a new one and get a fresh allowance. Every cap that exists for
 * security rather than tidiness stops meaning anything: the admin password
 * guess limit, and the per-inbox caps that stop this domain being used to mail
 * a stranger. It degrades silently, which is the dangerous part, so this makes
 * it visible in the logs.
 *
 * Deliberately NOT fail-closed. Denying instead would lock Michelle out of her
 * own admin panel and refuse real orders the moment Redis was missing, which is
 * a worse outcome for a one-person bakery than a weaker limit. The real fix is
 * configuring UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.
 */
function warnUnsharedInProduction() {
  if (warnedUnshared || process.env.NODE_ENV !== "production") return;
  warnedUnshared = true;
  console.error(
    "[rate-limit] No shared store configured (UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN). " +
      "Limits are per-instance only, so the admin sign-in cap and the per-inbox email caps do not " +
      "bind across instances. Configure Upstash before relying on them.",
  );
}
