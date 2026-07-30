"use client";

import { useState } from "react";
import Link from "next/link";
import { optOutOfMarketingAction } from "@/lib/optout-actions";
import { buttonClasses } from "@/components/ui/Button";

export function MarketingOptOutConfirm({ token }: { token: string }) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [error, setError] = useState("");

  async function optOut() {
    setState("busy");
    const result = await optOutOfMarketingAction(token);
    if (result.ok) setState("done");
    else {
      setError(result.error);
      setState("error");
    }
  }

  if (state === "done") {
    return (
      <div className="mt-4">
        <p className="text-muted">
          Done. We won&rsquo;t send you any more reminders or offers.
        </p>
        <p className="mt-3 text-sm text-muted">
          You&rsquo;ll still get updates about any order you place, so you always know when your
          treats are ready.
        </p>
        <Link href="/" className="mt-4 block text-sm font-semibold text-rose-deep hover:text-rose">
          Back to the bakery
        </Link>
      </div>
    );
  }

  return (
    <div className="mt-6">
      <button
        type="button"
        onClick={optOut}
        disabled={state === "busy" || !token}
        className={buttonClasses({ size: "lg" })}
      >
        {state === "busy" ? "Saving…" : "Stop sending these"}
      </button>
      {state === "error" && <p className="mt-3 text-sm text-rose-deep">{error}</p>}
      <Link href="/" className="mt-4 block text-sm font-semibold text-rose-deep hover:text-rose">
        Back to the bakery
      </Link>
    </div>
  );
}
