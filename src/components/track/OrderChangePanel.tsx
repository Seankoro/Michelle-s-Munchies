"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { rescheduleOrderAction, requestCancellationAction } from "@/app/track/actions";
import { compactInputClass as inputClass } from "@/lib/ui";

/**
 * Self-serve reschedule + cancellation request on the tracking page. Auth is the
 * tracking token in the URL. All scheduling rules are re-checked server-side.
 */
export function OrderChangePanel({
  token,
  currentDate,
  currentWindow,
  earliest,
  timeWindows,
}: {
  token: string;
  currentDate: string;
  currentWindow: string | null;
  earliest: string;
  timeWindows: string[];
}) {
  const router = useRouter();
  const [date, setDate] = useState(currentDate);
  const [window, setWindow] = useState(currentWindow ?? timeWindows[0] ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  async function reschedule() {
    setBusy(true);
    setMessage(null);
    const result = await rescheduleOrderAction(token, date, window);
    setBusy(false);
    if (result.ok) {
      setMessage({ kind: "ok", text: "Your order has been moved. Thank you!" });
      router.refresh();
    } else {
      setMessage({ kind: "error", text: result.error });
    }
  }

  async function requestCancel() {
    if (!confirm("Send a cancellation request to the bakery?")) return;
    setBusy(true);
    setMessage(null);
    const result = await requestCancellationAction(token);
    setBusy(false);
    setMessage(
      result.ok
        ? { kind: "ok", text: "We've passed your cancellation request to the bakery." }
        : { kind: "error", text: result.error },
    );
  }

  return (
    <div className="mt-6 rounded-2xl border border-line bg-white p-6">
      <h2 className="font-display text-xl font-semibold">Need to change something?</h2>
      <p className="mt-1 text-sm text-muted">
        Move your date or time before we start baking, or ask us to cancel.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm font-semibold">
          New date
          <input
            type="date"
            className={inputClass}
            min={earliest}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">
          Time window
          <select className={inputClass} value={window} onChange={(e) => setWindow(e.target.value)}>
            {timeWindows.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </label>
      </div>
      {message && (
        <p className={`mt-3 text-sm ${message.kind === "ok" ? "text-emerald-600" : "text-rose-deep"}`}>
          {message.text}
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={reschedule}
          disabled={busy}
          className="rounded-full bg-rose-deep px-5 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
        >
          Save new date
        </button>
        <button
          type="button"
          onClick={requestCancel}
          disabled={busy}
          className="rounded-full border border-line px-5 py-2 text-sm font-semibold text-rose-deep transition hover:border-rose disabled:opacity-50"
        >
          Request cancellation
        </button>
      </div>
    </div>
  );
}
