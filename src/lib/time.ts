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
