import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { singaporeDateString } from "@/lib/time";

/**
 * Cancel abandoned orders: still unpaid and in an early status, whose scheduled
 * date is at least a full day in the past. This frees the promo-redemption slot
 * and the reserved loyalty points such an order was holding, and clears it from
 * the bake list and analytics.
 *
 * Scoped deliberately: only `received`/`confirmed` orders, never `baking`,
 * `ready`, `out_for_delivery`, or `completed`, so an order the owner actually
 * worked on but has not yet marked paid is never auto-cancelled. Unpaid orders
 * never took stock or debited points, so there is nothing to reverse, and no
 * email is sent since these are abandoned by definition. Orders carrying a
 * deposit are left alone, since real money was taken and they need a human.
 *
 * Returns the number of orders cancelled.
 */
export async function expireStaleUnpaidOrders(): Promise<number> {
  const admin = createAdminClient();
  // Today in Singapore. A scheduled_date strictly before this is at least one
  // full day past, which is the owner's chosen grace window.
  const today = singaporeDateString();
  // Failed payments count as unpaid the same as pending ones, so an abandoned
  // order whose payment failed also frees its promo slot and held points.
  const { data, error } = await admin
    .from("orders")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .in("payment_status", ["pending", "failed"])
    .in("status", ["received", "confirmed"])
    .lt("scheduled_date", today)
    .or("deposit_cents.is.null,deposit_cents.eq.0")
    .select("id");
  if (error) throw new Error(`Failed to expire stale orders: ${error.message}`);
  return ((data as { id: string }[] | null) ?? []).length;
}
