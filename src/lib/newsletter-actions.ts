"use server";

import { requireAdmin, currentAdminEmail } from "@/lib/admin-auth";
import { rateLimit } from "@/lib/rate-limit";
import { fetchSuppressedEmails } from "@/lib/email-optout";
import { fetchStoreSettings } from "@/lib/settings";
import { sendNewsletterEmail } from "@/lib/email";
import {
  subscribeNewsletter,
  unsubscribeByToken,
  listActiveSubscribers,
  countActiveSubscribers,
} from "@/lib/newsletter";
import { EMAIL_RE, escapeHtml } from "@/lib/text";

/** Plain text to email HTML: blank lines split paragraphs, single newlines break lines. */
function renderNewsletterHtml(body: string): string {
  return `<p>${escapeHtml(body).replace(/\n{2,}/g, "</p><p>").replace(/\n/g, "<br/>")}</p>`;
}

export type SimpleResult = { ok: true } | { ok: false; error: string };

/** Public opt-in from checkout or sign-up. Rate-limited and feature-gated. */
export async function subscribeNewsletterAction(email: string): Promise<SimpleResult> {
  const normalized = email.trim().toLowerCase();
  if (!EMAIL_RE.test(normalized)) return { ok: false, error: "Please enter a valid email." };
  if (!(await rateLimit("newsletter-subscribe", { limit: 15, windowMs: 5 * 60_000 }))) {
    return { ok: false, error: "Too many requests. Please wait a few minutes." };
  }
  // Per-address throttle so repeat subscribes can't bombard one inbox with
  // confirmation emails. Keyed on the address alone, no client IP, or someone
  // rotating their source address would get a fresh budget for every send.
  if (
    !(await rateLimit(`newsletter-subscribe:${normalized}`, {
      limit: 3,
      windowMs: 60 * 60_000,
      scope: "global",
    }))
  ) {
    return { ok: true };
  }
  if (!(await fetchStoreSettings()).features.newsletter) {
    return { ok: false, error: "The newsletter isn’t available right now." };
  }
  await subscribeNewsletter(normalized);
  return { ok: true };
}

/** Public unsubscribe by token. */
export async function unsubscribeNewsletterAction(token: string): Promise<SimpleResult> {
  if (!(await rateLimit("newsletter-unsubscribe", { limit: 20, windowMs: 5 * 60_000 }))) {
    return { ok: false, error: "Too many requests. Please wait a few minutes." };
  }
  const ok = await unsubscribeByToken(token);
  return ok ? { ok: true } : { ok: false, error: "This link is no longer valid." };
}

/** How many subscribers a send would reach, for the admin compose screen. */
export async function newsletterAudienceAction(): Promise<{ count: number }> {
  await requireAdmin();
  return { count: await countActiveSubscribers() };
}

export type SendResult = { ok: true; sent: number } | { ok: false; error: string };

/** Admin send, composes the body from plain text and emails every subscriber. */
export async function sendNewsletterAction(subject: string, body: string): Promise<SendResult> {
  await requireAdmin();
  if (!subject.trim() || !body.trim()) return { ok: false, error: "Add a subject and a message." };
  if (!(await rateLimit("newsletter-send", { limit: 5, windowMs: 60 * 60_000 }))) {
    return { ok: false, error: "You've sent a few already. Please wait a bit." };
  }
  const bodyHtml = renderNewsletterHtml(body);
  const subscribers = await listActiveSubscribers();
  // The marketing opt-out page promises to stop reminders AND offers, and a
  // newsletter is an offer, so honour that list here too. Without this a
  // customer who opted out of everything still received the broadcast, which
  // makes the promise on that page untrue. One query for the whole send.
  const suppressed = await fetchSuppressedEmails(subscribers.map((s) => s.email));
  // Count what actually reached the provider, not what we attempted, so the
  // "sent to N people" confirmation is not quietly wrong when sends fail.
  let sent = 0;
  for (const sub of subscribers) {
    if (suppressed.has(sub.email.trim().toLowerCase())) continue;
    const delivered = await sendNewsletterEmail(
      sub.email,
      subject.trim(),
      bodyHtml,
      sub.unsubscribeToken,
    );
    if (delivered) sent += 1;
  }
  return { ok: true, sent };
}

export type TestResult = { ok: true; email: string } | { ok: false; error: string };

/** Send just to the signed-in admin, so a draft can be proofed in a real inbox first. */
export async function sendNewsletterTestAction(subject: string, body: string): Promise<TestResult> {
  await requireAdmin();
  if (!subject.trim() || !body.trim()) return { ok: false, error: "Add a subject and a message." };
  const email = await currentAdminEmail();
  if (!email) return { ok: false, error: "Could not find your admin email to send to." };
  if (!(await rateLimit("newsletter-test", { limit: 10, windowMs: 10 * 60_000 }))) {
    return { ok: false, error: "Sent a few tests already. Please wait a bit." };
  }
  const bodyHtml = renderNewsletterHtml(body);
  // A throwaway token, so the test's unsubscribe link simply reads as expired.
  await sendNewsletterEmail(email, `[Test] ${subject.trim()}`, bodyHtml, "test-preview");
  return { ok: true, email };
}
