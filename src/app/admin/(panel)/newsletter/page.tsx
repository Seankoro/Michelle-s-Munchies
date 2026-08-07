"use client";

import { useEffect, useState } from "react";
import {
  newsletterAudienceAction,
  sendNewsletterAction,
  sendNewsletterTestAction,
} from "@/lib/newsletter-actions";
import { cn } from "@/lib/cn";
import { compactInputClass as inputClass } from "@/lib/ui";

export default function AdminNewsletterPage() {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState<"send" | "test" | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    newsletterAudienceAction()
      .then((r) => setCount(r.count))
      .catch(() => setCount(null));
  }, []);

  const ready = subject.trim().length > 0 && body.trim().length > 0;
  const audienceLabel =
    count == null ? "…" : `${count} subscriber${count === 1 ? "" : "s"}`;

  async function send() {
    if (count === 0) return;
    if (!confirm(`Send this to all ${audienceLabel}?`)) return;
    setBusy("send");
    setMessage(null);
    try {
      const result = await sendNewsletterAction(subject, body);
      if (result.ok) {
        setMessage({
          kind: "ok",
          text: `Sent to ${result.sent} subscriber${result.sent === 1 ? "" : "s"}.`,
        });
        setSubject("");
        setBody("");
      } else {
        setMessage({ kind: "error", text: result.error });
      }
    } catch {
      // Without this the button would sit on "Sending…" for good, with nothing
      // on screen to say what went wrong. The send may have got part way through,
      // so warn her before she sends the same thing again.
      setMessage({
        kind: "error",
        text: "Couldn’t finish sending. Some subscribers may already have it, so check before you send again.",
      });
    } finally {
      setBusy(null);
    }
  }

  async function sendTest() {
    setBusy("test");
    setMessage(null);
    try {
      const result = await sendNewsletterTestAction(subject, body);
      setMessage(
        result.ok
          ? { kind: "ok", text: `Test sent to ${result.email}. Check your inbox.` }
          : { kind: "error", text: result.error },
      );
    } catch {
      setMessage({ kind: "error", text: "Couldn’t send the test email. Please try again." });
    } finally {
      setBusy(null);
    }
  }

  const paragraphs = body.trim() ? body.trim().split(/\n{2,}/) : [];

  return (
    <div className="max-w-2xl">
      <h1 className="font-display text-3xl font-semibold">Newsletter</h1>
      <p className="mt-1 text-muted">
        Write an update and send it to everyone who opted in. Each email includes an unsubscribe
        link.
      </p>

      <div className="mt-6 flex flex-col gap-4 rounded-2xl border border-line bg-white p-5">
        <div className="flex items-center justify-between gap-3 rounded-xl bg-blush-soft/50 px-4 py-2.5 text-sm">
          <span className="font-semibold text-ink">
            {count == null ? "Counting subscribers…" : `Reaches ${audienceLabel}`}
          </span>
          {count === 0 && <span className="text-muted">No one has opted in yet.</span>}
        </div>

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

        {/* Live preview of what lands in the inbox */}
        {ready && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Preview</p>
            <div className="mt-1 rounded-2xl border border-line bg-cream p-5">
              <p className="font-display text-lg font-semibold text-ink">{subject}</p>
              <div className="mt-2 flex flex-col gap-2 text-sm text-ink">
                {paragraphs.map((para, i) => (
                  <p key={i} className="whitespace-pre-line">
                    {para}
                  </p>
                ))}
              </div>
            </div>
          </div>
        )}

        {message && (
          <p className={`text-sm ${message.kind === "ok" ? "text-success" : "text-rose-ink"}`}>
            {message.text}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={send}
            disabled={busy != null || !ready || count === 0}
            className="rounded-full bg-rose-deep px-6 py-2.5 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:brightness-110 active:scale-95 disabled:pointer-events-none disabled:opacity-50"
          >
            {busy === "send" ? "Sending…" : `Send to ${audienceLabel}`}
          </button>
          <button
            type="button"
            onClick={sendTest}
            disabled={busy != null || !ready}
            className="rounded-full border border-line px-5 py-2.5 text-sm font-semibold text-ink transition hover:border-rose active:scale-95 disabled:pointer-events-none disabled:opacity-50"
          >
            {busy === "test" ? "Sending…" : "Send test to myself"}
          </button>
        </div>
        <p className="text-xs text-muted">
          Send a test to your own inbox first to check how it looks before it goes out to everyone.
        </p>
      </div>
    </div>
  );
}
