"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

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
  const router = useRouter();
  const target = new Date(availableFrom).getTime();
  const [now, setNow] = useState(() => Date.now());
  const refreshed = useRef(false);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  // Once the launch time passes, refresh so the server re-renders the page with
  // the product now buyable, instead of leaving a frozen "0h 0m".
  useEffect(() => {
    if (target - now <= 0 && !refreshed.current) {
      refreshed.current = true;
      router.refresh();
    }
  }, [target, now, router]);

  const { days, hours, mins } = parts(target - now);
  const launchLabel = new Date(availableFrom).toLocaleString("en-SG", {
    timeZone: "Asia/Singapore",
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
