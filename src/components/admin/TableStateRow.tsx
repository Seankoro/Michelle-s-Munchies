import type { ReactNode } from "react";

/**
 * A full-width message row for an admin table's loading / empty / no-match
 * states. Callers pass the table's column count (kept as one constant per table)
 * so the message always spans every column and the old colSpan drift can't recur.
 */
export function TableStateRow({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-8 text-center text-muted">
        {children}
      </td>
    </tr>
  );
}
