// Small pure text helpers shared across server actions and admin forms, so the
// same logic isn't redefined in a handful of files.

/** Escape the HTML-significant characters for safe interpolation into email HTML. */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** URL-friendly slug: lowercase, non-alphanumerics → dashes, trimmed. */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Loose email shape check (not validation — just a sanity gate). */
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
