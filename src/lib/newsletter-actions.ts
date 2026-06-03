"use server";

import { requireAdmin } from "@/lib/admin-auth";
import { rateLimit } from "@/lib/rate-limit";
import { fetchStoreSettings } from "@/lib/settings";
import { sendNewsletterEmail } from "@/lib/email";
import {
  subscribeNewsletter,
  unsubscribeByToken,
  listActiveSubscribers,
} from "@/lib/newsletter";
import { EMAIL_RE, escapeHtml } from "@/lib/text";

export type SimpleResult = { ok: true } | { ok: false; error: string };

/** Public opt-in (checkout / sign-up). Rate-limited + feature-gated. */
export async function subscribeNewsletterAction(email: string): Promise<SimpleResult> {
  if (!EMAIL_RE.test(email.trim())) return { ok: false, error: "Please enter a valid email." };
  if (!(await rateLimit("newsletter-subscribe", { limit: 15, windowMs: 5 * 60_000 }))) {
    return { ok: false, error: "Too many requests. Please wait a few minutes." };
  }
  if (!(await fetchStoreSettings()).features.newsletter) {
    return { ok: false, error: "The newsletter isn’t available right now." };
  }
  await subscribeNewsletter(email);
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

export type SendResult = { ok: true; sent: number } | { ok: false; error: string };

/** Admin send: composes the body from plain text and emails every subscriber. */
export async function sendNewsletterAction(subject: string, body: string): Promise<SendResult> {
  await requireAdmin();
  if (!subject.trim() || !body.trim()) return { ok: false, error: "Add a subject and a message." };
  if (!(await rateLimit("newsletter-send", { limit: 5, windowMs: 60 * 60_000 }))) {
    return { ok: false, error: "You've sent a few already. Please wait a bit." };
  }
  const bodyHtml = `<p>${escapeHtml(body).replace(/\n{2,}/g, "</p><p>").replace(/\n/g, "<br/>")}</p>`;
  const subscribers = await listActiveSubscribers();
  for (const sub of subscribers) {
    await sendNewsletterEmail(sub.email, subject.trim(), bodyHtml, sub.unsubscribeToken);
  }
  return { ok: true, sent: subscribers.length };
}
