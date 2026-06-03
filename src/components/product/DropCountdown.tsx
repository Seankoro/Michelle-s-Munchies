"use client";

import { useEffect, useState } from "react";

function parts(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return {
    days: Math.floor(s / 86400),
    hours: Math.floor((s % 86400) / 3600),
    mins: Math.floor((s % 3600) / 60),
  };
}

/** Live "launches in N days HH:MM" countdown for a seasonal drop. */
export function DropCountdown({ availableFrom }: { availableFrom: string }) {
  const target = new Date(availableFrom).getTime();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const { days, hours, mins } = parts(target - now);
  const launchLabel = new Date(availableFrom).toLocaleString("en-SG", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <div className="rounded-xl bg-blush-soft/60 px-4 py-3 text-sm text-rose-deep">
      <p className="font-semibold">Launching {launchLabel}</p>
      <p className="mt-1">
        Opens in {days > 0 ? `${days}d ` : ""}
        {hours}h {mins}m
      </p>
    </div>
  );
}
