import type { Product } from "@/lib/types";

/**
 * Coming soon, the one rule every surface asks. Michelle sets a product to
 * Coming soon in the admin, with or without a launch date:
 *
 * - No date: a teaser. It sits on the menu with a banner but has no link,
 *   no product page and no way into a cart, until she puts it on sale.
 * - A date: the card reads "Coming 12 Dec" and opens a countdown page with a
 *   waitlist. Once the time passes it is on sale by itself, with nothing to
 *   switch, because every read compares the date against the clock.
 *
 * The launch date is kept while the product is on sale or sold out, so it is
 * still there if she sets Coming soon again, but it does nothing until then.
 */
type LaunchFields = Pick<Product, "comingSoon" | "availableFrom">;

/** Singapore has no daylight saving, so one fixed offset is exact all year. */
const SGT_OFFSET = "+08:00";
const SGT_OFFSET_MS = 8 * 60 * 60 * 1000;

/** Not on sale yet: set to Coming soon, with no date or a date still ahead. */
export function isComingSoon(product: LaunchFields, now = new Date()): boolean {
  if (!product.comingSoon) return false;
  return !product.availableFrom || new Date(product.availableFrom) > now;
}

/**
 * Coming soon with no date. Needs no clock, so the server and the browser
 * always agree, and a teaser card never flashes a link while it hydrates.
 */
export function isTeaser(product: LaunchFields): boolean {
  return Boolean(product.comingSoon) && !product.availableFrom;
}

/** The menu banner: "Coming soon", or "Coming 12 Dec" once a date is set. */
export function comingSoonLabel(product: LaunchFields): string {
  if (!product.availableFrom) return "Coming soon";
  const day = new Date(product.availableFrom).toLocaleDateString("en-SG", {
    timeZone: "Asia/Singapore",
    day: "numeric",
    month: "short",
  });
  return `Coming ${day}`;
}

/** Split a stored launch time into the admin's Singapore date and time fields. */
export function toSgtParts(iso: string): { date: string; time: string } {
  const shifted = new Date(new Date(iso).getTime() + SGT_OFFSET_MS).toISOString();
  return { date: shifted.slice(0, 10), time: shifted.slice(11, 16) };
}

/** Join the admin's Singapore date ("2026-12-12") and time ("10:00") into a stored time. */
export function fromSgtParts(date: string, time: string): string {
  return new Date(`${date}T${time}:00${SGT_OFFSET}`).toISOString();
}

/** "13:30" as "1:30 pm". */
export function launchTimeLabel(value: string): string {
  const [h, m] = value.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

/** Launch time choices for the admin: every half hour from 7:00 am to 10:00 pm. */
export const LAUNCH_TIMES: { value: string; label: string }[] = Array.from(
  { length: 31 },
  (_, i) => {
    const minutes = 7 * 60 + i * 30;
    const value = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${minutes % 60 === 0 ? "00" : "30"}`;
    return { value, label: launchTimeLabel(value) };
  },
);

/** The time a new launch date starts on. */
export const DEFAULT_LAUNCH_TIME = "10:00";
