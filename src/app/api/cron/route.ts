import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { fetchStoreSettings } from "@/lib/settings";
import { sendAbandonedReminders } from "@/lib/checkout-intents";
import { grantBirthdayRewards } from "@/lib/birthday";
import { notifyLaunchedDrops } from "@/lib/stock-notify";

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
 * Runs abandoned-cart reminders and birthday rewards, each gated by its feature flag.
 */
export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const settings = await fetchStoreSettings();
  const result: Record<string, number | string> = {};

  if (settings.features.abandonedCart) {
    result.abandonedReminders = await sendAbandonedReminders(settings.abandonedAfterHours);
  } else {
    result.abandonedReminders = "skipped (feature off)";
  }

  if (settings.features.birthdayRewards) {
    result.birthdayRewards = await grantBirthdayRewards();
  } else {
    result.birthdayRewards = "skipped (feature off)";
  }

  if (settings.features.drops) {
    result.dropsChecked = await notifyLaunchedDrops();
  } else {
    result.dropsChecked = "skipped (feature off)";
  }

  return NextResponse.json({ ok: true, ...result });
}
