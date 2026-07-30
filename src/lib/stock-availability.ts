import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The payment states that still owe money. stock_count only moves when an order
 * is marked paid, so these are exactly the orders whose units are promised to a
 * customer and yet still counted as sitting on the shelf. 'paid' is left out
 * because those units have already come out of stock_count, and 'refunded'
 * because the cancel that refunded them put them back.
 */
const UNPAID_PAYMENT_STATUSES = ["pending", "failed"];

/** An order line, once the unpaid and non-cancelled filters have done their work. */
type CommittedRow = { product_id: string; quantity: number };

/**
 * Units already promised per product id, counted across open orders: every
 * non-cancelled order that has not been paid yet.
 *
 * Michelle marks a PayNow transfer paid by hand, often days after the order
 * arrives, and stock_count is decremented only at that moment. So between
 * ordering and marking paid the units are sold but still inside stock_count,
 * and anything gating a new sale has to subtract them or the same batch gets
 * sold over and over. A paid order is deliberately not counted here: its units
 * are already out of stock_count, so counting them again would subtract twice.
 *
 * One query for every id asked about. Products with nothing outstanding are
 * absent from the map rather than present as zero. A bundle or build-a-box line
 * stores no product_id, so its contents are invisible here, the same way the
 * paid-time decrement also only moves stock for plain product lines. Read with
 * the service-role client because orders are not publicly readable.
 */
export async function fetchCommittedUnits(productIds: string[]): Promise<Map<string, number>> {
  const committed = new Map<string, number>();
  if (productIds.length === 0) return committed;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("order_items")
    .select("product_id, quantity, orders!inner(status, payment_status)")
    .in("product_id", productIds)
    .neq("orders.status", "cancelled")
    .in("orders.payment_status", UNPAID_PAYMENT_STATUSES);
  // Throw rather than fall back to "nothing is committed". A silent zero would
  // quietly reopen the overselling hole this count exists to close, and every
  // caller sits behind a handler that turns a thrown fault into a plain line.
  if (error) throw new Error(`Failed to count committed stock: ${error.message}`);

  for (const row of (data as CommittedRow[] | null) ?? []) {
    committed.set(row.product_id, (committed.get(row.product_id) ?? 0) + row.quantity);
  }
  return committed;
}
