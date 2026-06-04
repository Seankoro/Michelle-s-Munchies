"use client";

import { useState } from "react";

export function ReferralCard({
  code,
  referrerPoints,
  refereePoints,
}: {
  code: string;
  referrerPoints: number;
  refereePoints: number;
}) {
  const [copied, setCopied] = useState(false);

  async function copyLink() {
    const link = `${window.location.origin}/account/sign-up?ref=${code}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard blocked, the code is shown below regardless.
    }
  }

  return (
    <div className="rounded-2xl bg-sky/30 p-5">
      <p className="text-sm font-semibold text-sky-deep">🎁 Invite friends</p>
      <p className="mt-1 text-sm text-ink">
        Share your code. When a friend places their first order, you earn{" "}
        <span className="font-semibold">{referrerPoints} points</span> and they get{" "}
        <span className="font-semibold">{refereePoints}</span>.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <span className="rounded-xl border border-line bg-white px-4 py-2 font-display text-lg font-semibold tracking-[0.2em] text-ink">
          {code}
        </span>
        <button
          type="button"
          onClick={copyLink}
          className="rounded-full bg-rose-deep px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110"
        >
          {copied ? "Link copied ✓" : "Copy invite link"}
        </button>
      </div>
    </div>
  );
}
