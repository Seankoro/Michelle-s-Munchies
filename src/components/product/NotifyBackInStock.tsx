"use client";

import { useState } from "react";
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

  const enabled = mode === "drop" ? features.drops : features.backInStock;
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
      setMessage("We'll email you the moment it's back. 🎀");
    } else {
      setStatus("error");
      setMessage(result.error);
    }
  }

  if (status === "done") {
    return <p className="mt-4 rounded-xl bg-blush-soft/60 px-4 py-3 text-sm text-rose-deep">{message}</p>;
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
          className="flex-1 rounded-xl border border-line bg-white px-3 py-2 text-sm outline-none focus:border-rose"
        />
        <button
          type="submit"
          disabled={status === "sending"}
          className="rounded-full bg-rose-deep px-5 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
        >
          {status === "sending" ? "…" : "Notify me"}
        </button>
      </div>
      {status === "error" && <p className="mt-2 text-sm text-rose-deep">{message}</p>}
    </form>
  );
}
