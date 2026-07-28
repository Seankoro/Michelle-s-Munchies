import { NextResponse, type NextRequest } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { timingSafeEqual } from "node:crypto";
import { fetchStoreSettings } from "@/lib/settings";
import { sendAbandonedReminders } from "@/lib/checkout-intents";
import { grantBirthdayRewards } from "@/lib/birthday";
import { notifyLaunchedDrops } from "@/lib/stock-notify";
import { sendWinbackNudges } from "@/lib/winback";
import { sendOccasionReminders } from "@/lib/occasions";
import { expireStaleUnpaidOrders } from "@/lib/order-cleanup";

export const dynamic = "force-dynamic";

/** Constant-time bearer-token check against CRON_SECRET. */
function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Scheduled work, triggered hourly by an external scheduler that calls this URL.
 * Protected by a secret bearer token so it can't be triggered to spam emails.
 * Runs abandoned-cart reminders, birthday rewards, and seasonal-drop go-live
 * notifications, each gated by its feature flag.
 */
// Sentry cron monitor: the route checks in on every run, so Sentry alerts
// when the EXTERNAL scheduler silently stops calling us — a failure mode error
// tracking alone can never see. Auto-creates the monitor on first check-in.
const MONITOR_SLUG = "hourly-jobs";
const MONITOR_CONFIG = {
  schedule: { type: "interval", value: 1, unit: "hour" },
  checkinMargin: 15,
  maxRuntime: 10,
  timezone: "Asia/Singapore",
} as const;

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Only production check-ins count toward the schedule; a stray dev run would
  // otherwise register a "development" environment that then reads as missed.
  const monitored = process.env.NODE_ENV === "production";
  const checkInId = monitored
    ? Sentry.captureCheckIn({ monitorSlug: MONITOR_SLUG, status: "in_progress" }, MONITOR_CONFIG)
    : null;

  const settings = await fetchStoreSettings();
  const result: Record<string, number | string> = {};

  // Each job is isolated so one failure never blocks the others, and every
  // failure is reported rather than silently ending the hourly run.
  async function run(name: string, enabled: boolean, job: () => Promise<number>) {
    if (!enabled) {
      result[name] = "skipped (feature off)";
      return;
    }
    try {
      result[name] = await job();
    } catch (error) {
      console.error(`[cron] ${name} failed:`, error);
      Sentry.captureException(error, { extra: { job: name } });
      result[name] = "failed";
    }
  }

  await run("abandonedReminders", settings.features.abandonedCart, () =>
    sendAbandonedReminders(settings.abandonedAfterHours),
  );
  await run("birthdayRewards", settings.features.birthdayRewards, () => grantBirthdayRewards());
  await run("dropsChecked", settings.features.drops, () => notifyLaunchedDrops());
  // Win-back rides the same automated-lifecycle-email switch as abandoned cart.
  await run("winbackNudges", settings.features.abandonedCart, () => sendWinbackNudges());
  await run("occasionReminders", settings.features.occasionReminders, () =>
    sendOccasionReminders(),
  );
  // Housekeeping, always on: cancel unpaid orders left in an early status past
  // their scheduled date, so they stop holding promo slots and reserved points.
  await run("expiredOrders", true, () => expireStaleUnpaidOrders());

  if (checkInId) {
    const anyFailed = Object.values(result).includes("failed");
    Sentry.captureCheckIn(
      { checkInId, monitorSlug: MONITOR_SLUG, status: anyFailed ? "error" : "ok" },
      MONITOR_CONFIG,
    );
  }
  // Serverless functions can freeze right after responding, so push any
  // buffered check-ins and captured errors out before returning.
  await Sentry.flush(2000);

  return NextResponse.json({ ok: true, ...result });
}
