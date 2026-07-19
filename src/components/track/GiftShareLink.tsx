"use client";

import { useEffect, useState } from "react";

/**
 * Shown on the buyer's tracking page for a gift they left the recipient to
 * schedule. Surfaces the shareable /gift/<token> link with a copy button. The
 * absolute URL is built on the client so it works on any deploy host.
 */
export function GiftShareLink({ path }: { path: string }) {
  const [url, setUrl] = useState(path);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setUrl(`${window.location.origin}${path}`);
  }, [path]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked: the field is selectable so they can copy by hand.
    }
  }

  return (
    <div className="mt-6 rounded-2xl border border-rose/30 bg-blush-soft/60 p-5">
      <p className="font-display text-lg font-semibold text-rose-deep">Share with the recipient 🎁</p>
      <p className="mt-1 text-sm text-rose-deep">
        Send them this link so they can add their delivery address and pick a time. We&rsquo;ll let
        you know once they have.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          readOnly
          value={url}
          onFocus={(e) => e.target.select()}
          aria-label="Gift link to share"
          className="min-w-0 flex-1 rounded-xl border border-line bg-white px-3 py-2 text-sm"
        />
        <button
          type="button"
          onClick={copy}
          className="rounded-full bg-rose-deep px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 active:scale-95"
        >
          {copied ? "Copied ✓" : "Copy link"}
        </button>
      </div>
    </div>
  );
}
