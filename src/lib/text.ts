// Small pure text helpers shared across server actions and admin forms, so the
// same logic isn't redefined in a handful of files.

/** Escape the HTML-significant characters for safe interpolation into email HTML. */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** URL-friendly slug, lowercase with non-alphanumerics turned to dashes, trimmed. */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Loose email shape check, not validation, just a sanity gate. */
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The mailbox an address actually reaches, for use as a rate-limit key ONLY.
 *
 * "a@gmail.com", "a+1@gmail.com" and "a.a@gmail.com" all deliver to one inbox,
 * but each is a different string, so a per-inbox cap keyed on the raw address
 * hands the same person a fresh budget for every alias they invent. That turns
 * a three-an-hour reset cap into as many as they care to type.
 *
 * NEVER store or send to the value this returns. Dot-folding is a Google rule
 * and is wrong elsewhere, so the canonical form can point at a different
 * mailbox than the one the customer typed. The address the customer gave is
 * always the one that gets written down and mailed.
 *
 * It cannot cover every provider, so it narrows the hole rather than closing
 * it, and the per-source caps still sit alongside.
 */
export function canonicalEmail(email: string): string {
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.lastIndexOf("@");
  if (at <= 0) return trimmed;
  let local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  const plus = local.indexOf("+");
  if (plus > 0) local = local.slice(0, plus);
  if (domain === "gmail.com" || domain === "googlemail.com") {
    local = local.split(".").join("");
  }
  return `${local}@${domain}`;
}
