"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { scheduleGiftAction } from "@/app/gift/actions";
import { compactInputClass as inputClass } from "@/lib/ui";

/**
 * Where a gift recipient enters their own delivery address and picks a time
 * window. It only collects and submits; the server re-checks the slot and saves.
 */
export function GiftScheduleForm({
  token,
  timeWindows,
}: {
  token: string;
  timeWindows: string[];
}) {
  const router = useRouter();
  const [line1, setLine1] = useState("");
  const [unit, setUnit] = useState("");
  const [postal, setPostal] = useState("");
  const [timeWindow, setTimeWindow] = useState(timeWindows[0] ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setError("");
    setBusy(true);
    const result = await scheduleGiftAction(token, { line1, unit, postalCode: postal }, timeWindow);
    setBusy(false);
    if (result.ok) {
      router.refresh();
    } else {
      setError(result.error);
    }
  }

  return (
    <div className="mt-6 flex flex-col gap-3 rounded-2xl border border-line bg-white p-5">
      <h2 className="font-display text-2xl font-semibold">Where should we deliver?</h2>
      <div className="grid gap-2 sm:grid-cols-2">
        <input
          className={`${inputClass} sm:col-span-2`}
          placeholder="Block & street"
          aria-label="Block and street"
          autoComplete="address-line1"
          value={line1}
          onChange={(e) => setLine1(e.target.value)}
        />
        <input
          className={inputClass}
          placeholder="Unit (optional)"
          aria-label="Unit (optional)"
          autoComplete="address-line2"
          value={unit}
          onChange={(e) => setUnit(e.target.value)}
        />
        <input
          className={inputClass}
          placeholder="Postal code"
          aria-label="Postal code"
          autoComplete="postal-code"
          value={postal}
          onChange={(e) => setPostal(e.target.value)}
          inputMode="numeric"
        />
        <select
          className={`${inputClass} sm:col-span-2`}
          value={timeWindow}
          onChange={(e) => setTimeWindow(e.target.value)}
          aria-label="Delivery time"
        >
          {timeWindows.map((window) => (
            <option key={window} value={window}>
              {window}
            </option>
          ))}
        </select>
      </div>
      {error && (
        <p role="alert" className="text-sm text-rose-ink">
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={submit}
        disabled={busy}
        className="self-start rounded-full bg-rose-deep px-5 py-2 text-sm font-semibold text-white transition hover:brightness-110 active:scale-95 disabled:opacity-60"
      >
        {busy ? "Saving…" : "Confirm my details"}
      </button>
    </div>
  );
}
