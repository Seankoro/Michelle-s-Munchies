// Pure, client-safe iCalendar builder for upcoming orders, output as .ics text.
// One all-day VEVENT per order so Michelle can see the day's bakes in her calendar app.

export type IcsOrder = {
  orderNumber: string;
  scheduledDate: string; // yyyy-mm-dd
  timeWindow: string | null;
  itemSummary: string; // e.g. "5 items"
};

function escapeText(line: string): string {
  // Escape ICS-special characters in text values.
  return line.replace(/([,;\\])/g, "\\$1").replace(/\n/g, "\\n");
}

/** yyyy-mm-dd to the ICS basic date form, optionally shifted by whole days. */
function icsDate(iso: string, addDays = 0): string {
  const [y, m, d] = iso.split("-").map(Number);
  // UTC arithmetic so the shift can never land on the wrong day in a local zone.
  return new Date(Date.UTC(y, m - 1, d + addDays)).toISOString().slice(0, 10).replace(/-/g, "");
}

export function buildOrdersIcs(orders: IcsOrder[]): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Michelle's Munchies//Orders//EN",
    "CALSCALE:GREGORIAN",
  ];
  // RFC 5545 makes DTSTAMP required in every VEVENT. Lenient importers invent
  // one, strict ones can refuse the whole file, so we say when we built it.
  // One stamp for the export, since that is the moment being described.
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  for (const order of orders) {
    const date = icsDate(order.scheduledDate);
    const summary = escapeText(
      `${order.orderNumber} (${order.itemSummary})${order.timeWindow ? ` ${order.timeWindow}` : ""}`,
    );
    lines.push(
      "BEGIN:VEVENT",
      `UID:${order.orderNumber}@michelles-munchies`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${date}`,
      // An all-day event's DTEND is exclusive, so the day after DTSTART keeps
      // the bake on exactly one day in importers that expect an explicit end.
      `DTEND;VALUE=DATE:${icsDate(order.scheduledDate, 1)}`,
      `SUMMARY:${summary}`,
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}
