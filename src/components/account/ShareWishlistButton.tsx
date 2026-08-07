"use client";

import { useState } from "react";
import { useFeatures } from "@/components/features/FeaturesProvider";
import { Button } from "@/components/ui/Button";
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
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={share}
        disabled={status === "loading"}
      >
        {status === "copied" ? "Link copied ✓" : status === "loading" ? "…" : "🔗 Share my wishlist"}
      </Button>
      {status === "error" && <p className="mt-1 text-sm text-rose-ink">{message}</p>}
    </div>
  );
}
