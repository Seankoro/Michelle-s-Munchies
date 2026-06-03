"use client";

import { useState } from "react";
import { useFeatures } from "@/components/features/FeaturesProvider";
import { getWishlistShareLinkAction } from "@/app/account/actions";

/** Copies a read-only link to the signed-in user's favourites. */
export function ShareWishlistButton() {
  const features = useFeatures();
  const [status, setStatus] = useState<"idle" | "loading" | "copied" | "error">("idle");
  const [message, setMessage] = useState("");

  if (!features.wishlistSharing) return null;

  async function share() {
    setStatus("loading");
    const result = await getWishlistShareLinkAction();
    if (!result.ok) {
      setStatus("error");
      setMessage(result.error);
      return;
    }
    try {
      await navigator.clipboard.writeText(result.url);
      setStatus("copied");
      window.setTimeout(() => setStatus("idle"), 2000);
    } catch {
      window.prompt("Copy your wishlist link:", result.url);
      setStatus("idle");
    }
  }

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={share}
        disabled={status === "loading"}
        className="rounded-full border border-line px-4 py-2 text-sm font-semibold transition hover:border-rose disabled:opacity-50"
      >
        {status === "copied" ? "Link copied ✓" : status === "loading" ? "…" : "🔗 Share my wishlist"}
      </button>
      {status === "error" && <p className="mt-1 text-sm text-rose-deep">{message}</p>}
    </div>
  );
}
