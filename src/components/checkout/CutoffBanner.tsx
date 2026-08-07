"use client";

import { useEffect, useState } from "react";
import { singaporeNow } from "@/lib/time";

function format12h(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const ampm = h >= 12 ? "pm" : "am";
  const h12 = ((h + 11) % 12) + 1;
  return m ? `${h12}:${String(m).padStart(2, "0")}${ampm}` : `${h12}${ampm}`;
}

/** Live "order by <cutoff>" banner. Counts down to today's same-day cutoff. */
export function CutoffBanner({
  cutoffTime,
  earliestLabel,
}: {
  cutoffTime: string;
  earliestLabel: string;
}) {
  const [remaining, setRemaining] = useState<string | null>(null);

  useEffect(() => {
    function tick() {
      const [h, m] = cutoffTime.split(":").map(Number);
      // Singapore time, not the phone's. The cutoff the server enforces is
      // Singapore's, so a device on another timezone or a wrong clock used to
      // count down to a deadline that was not the real one.
      const now = singaporeNow();
      const cutoff = new Date(now);
      cutoff.setHours(h, m || 0, 0, 0);
      const diff = cutoff.getTime() - now.getTime();
      if (diff <= 0) {
        setRemaining(null);
        return;
      }
      const hrs = Math.floor(diff / 3_600_000);
      const mins = Math.floor((diff % 3_600_000) / 60_000);
      setRemaining(`${hrs}h ${mins}m`);
    }
    tick();
    const id = window.setInterval(tick, 60_000);
    return () => window.clearInterval(id);
  }, [cutoffTime]);

  return (
    <div className="rounded-xl bg-blush-soft/60 px-4 py-3 text-sm text-rose-ink">
      {remaining
        ? `🕒 Order within ${remaining}, before today's ${format12h(cutoffTime)} cutoff, for the earliest pickup or delivery date.`
        : `🕒 Today's ${format12h(cutoffTime)} cutoff has passed. The earliest date is now ${earliestLabel}.`}
    </div>
  );
}
