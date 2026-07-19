/**
 * Singapore time helpers. The business runs on Singapore time, UTC+8, but a
 * Vercel server runs in UTC. Any "what day or hour is it right now" decision must
 * therefore be made in Asia/Singapore, or the same-day cutoff and earliest
 * fulfillment date come out hours off and the server disagrees with the
 * customer's browser.
 */

/**
 * The current moment expressed so its local fields like getHours and getDate
 * read as Singapore wall-clock time, whatever timezone the server runs in. Pass
 * this as the `now` or `today` argument to the date helpers in `order.ts`.
 */
export function singaporeNow(): Date {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Singapore" }));
}

/**
 * A moment's calendar date in Singapore as "YYYY-MM-DD", for comparing against
 * date-only columns like scheduled_date and expires_at. Defaults to now.
 */
export function singaporeDateString(input: string | number | Date = Date.now()): string {
  return new Date(input).toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" });
}
