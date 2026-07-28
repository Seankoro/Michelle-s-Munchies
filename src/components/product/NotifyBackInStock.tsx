"use client";

import { useEffect, useRef, useState } from "react";
import { useFeatures } from "@/components/features/FeaturesProvider";
import { subscribeBackInStockAction } from "@/lib/stock-actions";

/**
 * Shown on a sold-out product. Guests enter an email. Signed-in users can leave
 * it blank, and the server uses their account email. Gated by the back-in-stock
 * feature.
 */
export function NotifyBackInStock({
  productId,
  mode = "soldout",
}: {
  productId: string;
  mode?: "soldout" | "drop";
}) {
  const features = useFeatures();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [message, setMessage] = useState("");
  const statusRef = useRef<HTMLDivElement>(null);

  const enabled = mode === "drop" ? features.drops : features.backInStock;

  // Move focus to the status region once it has something to announce, so
  // screen-reader users get the result even though the form unmounts (on
  // success) or stays put with a new sibling (on error).
  useEffect(() => {
    if (status === "done" || status === "error") {
      statusRef.current?.focus();
    }
  }, [status]);

  if (!enabled) return null;
  const heading =
    mode === "drop"
      ? "Join the waitlist and we'll email you when it launches"
      : "Sold out. Get notified when it's back";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    const result = await subscribeBackInStockAction(productId, email);
    if (result.ok) {
      setStatus("done");
      setMessage(
        result.confirmed
          ? "We'll email you the moment it's back. 🎀"
          : "Almost there! Check your inbox and tap the confirmation link. 🎀",
      );
    } else {
      setStatus("error");
      setMessage(result.error);
    }
  }

  if (status === "done") {
    return (
      <div
        ref={statusRef}
        role="status"
        aria-live="polite"
        tabIndex={-1}
        className="mt-4 rounded-xl bg-blush-soft/60 px-4 py-3 text-sm text-rose-deep"
      >
        {message}
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="mt-4 rounded-xl border border-line bg-white p-4">
      <p className="text-sm font-semibold text-ink">{heading}</p>
      <div className="mt-2 flex gap-2">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@email.com"
          aria-label="Email address"
          className="flex-1 rounded-xl border border-line bg-white px-3 py-2 text-sm focus:border-rose"
        />
        <button
          type="submit"
          disabled={status === "sending"}
          className="rounded-full bg-rose-deep px-5 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
        >
          {status === "sending" ? "…" : "Notify me"}
        </button>
      </div>
      {status === "error" && (
        <div ref={statusRef} role="status" aria-live="polite" tabIndex={-1}>
          <p className="mt-2 text-sm text-rose-deep">{message}</p>
        </div>
      )}
    </form>
  );
}
