"use client";

import { useState } from "react";
import { sendNewsletterAction } from "@/lib/newsletter-actions";
import { cn } from "@/lib/cn";
import { compactInputClass as inputClass } from "@/lib/ui";

export default function AdminNewsletterPage() {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);


  async function send() {
    if (!confirm("Send this to all subscribers?")) return;
    setBusy(true);
    setMessage(null);
    const result = await sendNewsletterAction(subject, body);
    setBusy(false);
    if (result.ok) {
      setMessage({ kind: "ok", text: `Sent to ${result.sent} subscriber${result.sent === 1 ? "" : "s"}.` });
      setSubject("");
      setBody("");
    } else {
      setMessage({ kind: "error", text: result.error });
    }
  }

  return (
    <div className="max-w-2xl">
      <h1 className="font-display text-3xl font-semibold">Newsletter</h1>
      <p className="mt-1 text-muted">
        Write an update and send it to everyone who opted in. Each email includes an unsubscribe
        link.
      </p>

      <div className="mt-6 flex flex-col gap-4 rounded-2xl border border-line bg-white p-5">
        <label className="flex flex-col gap-1 text-sm font-semibold">
          Subject
          <input className={inputClass} value={subject} onChange={(e) => setSubject(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">
          Message
          <textarea
            className={cn(inputClass, "min-h-48 resize-y")}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write your update. Leave a blank line between paragraphs."
          />
        </label>
        {message && (
          <p className={`text-sm ${message.kind === "ok" ? "text-emerald-600" : "text-rose-deep"}`}>
            {message.text}
          </p>
        )}
        <button
          type="button"
          onClick={send}
          disabled={busy}
          className="self-start rounded-full bg-rose-deep px-6 py-2.5 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:brightness-110 active:scale-95 disabled:opacity-50"
        >
          {busy ? "Sending…" : "Send to subscribers"}
        </button>
      </div>
    </div>
  );
}
