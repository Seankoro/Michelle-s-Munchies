// Pure, client-safe iCalendar builder for upcoming orders, output as .ics text.
// One all-day VEVENT per order so Michelle can see the day's bakes in her calendar app.

export type IcsOrder = {
  orderNumber: string;
  scheduledDate: string; // yyyy-mm-dd
  timeWindow: string | null;
  itemSummary: string; // e.g. "5 items"
};

function fold(line: string): string {
  // Escape ICS-special characters in text values.
  return line.replace(/([,;\\])/g, "\\$1").replace(/\n/g, "\\n");
}

export function buildOrdersIcs(orders: IcsOrder[]): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Michelle's Munchies//Orders//EN",
    "CALSCALE:GREGORIAN",
  ];
  for (const order of orders) {
    const date = order.scheduledDate.replace(/-/g, "");
    const summary = fold(
      `${order.orderNumber} (${order.itemSummary})${order.timeWindow ? ` ${order.timeWindow}` : ""}`,
    );
    lines.push(
      "BEGIN:VEVENT",
      `UID:${order.orderNumber}@michelles-munchies`,
      `DTSTART;VALUE=DATE:${date}`,
      `SUMMARY:${summary}`,
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}
