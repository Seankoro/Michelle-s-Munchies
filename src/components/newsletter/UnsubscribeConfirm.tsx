"use client";

import { useState } from "react";
import Link from "next/link";
import { unsubscribeNewsletterAction } from "@/lib/newsletter-actions";
import { buttonClasses } from "@/components/ui/Button";

export function UnsubscribeConfirm({ token }: { token: string }) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [error, setError] = useState("");

  async function unsubscribe() {
    setState("busy");
    const result = await unsubscribeNewsletterAction(token);
    if (result.ok) setState("done");
    else {
      setError(result.error);
      setState("error");
    }
  }

  if (state === "done") {
    return (
      <p className="mt-4 text-muted">You&rsquo;ve been unsubscribed. We&rsquo;re sorry to see you go!</p>
    );
  }

  return (
    <div className="mt-6">
      <button
        type="button"
        onClick={unsubscribe}
        disabled={state === "busy" || !token}
        className={buttonClasses({ size: "lg" })}
      >
        {state === "busy" ? "Unsubscribing…" : "Unsubscribe me"}
      </button>
      {state === "error" && <p className="mt-3 text-sm text-rose-deep">{error}</p>}
      <Link href="/" className="mt-4 block text-sm font-semibold text-rose hover:text-rose-deep">
        Back to the bakery
      </Link>
    </div>
  );
}
