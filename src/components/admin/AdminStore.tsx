"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Product } from "@/lib/types";
import type { AdminOrder, OrderStatus, PaymentStatus } from "@/lib/order";
import type { FeatureFlags, NotePrompt } from "@/lib/settings";
import { ALL_FEATURES_ON } from "@/lib/feature-flags";
import {
  cancelOrderAction,
  createManualOrderAction,
  createProductAction,
  deleteProductAction,
  loadAdminData,
  recordRefundAction,
  removeOrderItemsAction,
  rescheduleOrderAdminAction,
  setDeliveryAddressAction,
  updateOrderStatusAction,
  updateOwnerNoteAction,
  updatePaymentStatusAction,
  updateProductAction,
  updateSettingsAction,
  type ManualOrderResult,
  type RecordRefundResult,
  type RemoveItemsResult,
} from "@/lib/admin-actions";
import type { ManualOrderInput } from "@/lib/orders-db";

export type AdminSettings = {
  deliveryFeeCents: number;
  freeDeliveryMinCents: number;
  minOrderCents: number;
  leadTimeDays: number;
  timeWindows: string[];
  blackoutDates: string[];
  pickupLocation: string;
  /** Max orders per fulfillment day. null means unlimited. */
  dailyOrderCap: number | null;
  /** Max orders per date and time window. null means unlimited. */
  perWindowCap: number | null;
  /** Same-day order cutoff as "HH:MM". null means none. */
  dailyCutoffTime: string | null;
  /** Spend-gift nudge, the threshold and product. null means off. */
  freeGiftThresholdCents: number | null;
  freeGiftProductId: string | null;
  birthdayRewardPoints: number;
  abandonedAfterHours: number;
  notePrompts: NotePrompt[];
  lowStockThreshold: number | null;
  /** Owner-written lines for the mascot's speech bubble, added to the automatic ones. */
  mascotMessages: string[];
  pointsPerDollar: number;
  pointValueCents: number;
  referralReferrerPoints: number;
  referralRefereePoints: number;
  features: FeatureFlags;
};

const defaultSettings: AdminSettings = {
  deliveryFeeCents: 800,
  freeDeliveryMinCents: 5000,
  minOrderCents: 0,
  leadTimeDays: 2,
  timeWindows: ["Morning (9am–12pm)", "Afternoon (12–4pm)", "Evening (4–8pm)"],
  blackoutDates: [],
  pickupLocation: "",
  dailyOrderCap: null,
  perWindowCap: null,
  dailyCutoffTime: null,
  freeGiftThresholdCents: null,
  freeGiftProductId: null,
  birthdayRewardPoints: 0,
  abandonedAfterHours: 4,
  notePrompts: [],
  lowStockThreshold: null,
  mascotMessages: [],
  pointsPerDollar: 1,
  pointValueCents: 5,
  referralReferrerPoints: 50,
  referralRefereePoints: 30,
  features: { ...ALL_FEATURES_ON },
};

type AdminContextValue = {
  products: Product[];
  orders: AdminOrder[];
  settings: AdminSettings;
  hydrated: boolean;
  error: string | null;
  /** Re-pull everything from the server. Safe to call any time. */
  refresh: () => Promise<void>;
  /** A re-pull is in flight, so a retry button can show it is doing something. */
  loading: boolean;
  lastUpdated: Date | null;
  toggleAvailability: (id: string) => void;
  toggleBestSeller: (id: string) => void;
  toggleRecommended: (id: string) => void;
  updateProduct: (id: string, patch: Partial<Product>) => void;
  addProduct: (product: Product) => void;
  deleteProduct: (id: string) => void;
  updateOrderStatus: (orderNumber: string, status: OrderStatus) => void;
  updatePaymentStatus: (orderNumber: string, paymentStatus: PaymentStatus) => void;
  updateOwnerNote: (orderNumber: string, note: string) => void;
  rescheduleOrder: (orderNumber: string, date: string, timeWindow: string) => void;
  /** Set or correct where a delivery order is going, and the window it goes in. */
  setDeliveryAddress: (
    orderNumber: string,
    address: { line1: string; unit: string; postalCode: string },
    timeWindow: string,
  ) => void;
  addManualOrder: (input: ManualOrderInput) => Promise<ManualOrderResult>;
  /** `cancelWithoutRefund` overrides a Stripe refusal Stripe will never accept.
   *  Always call it off first, so the override is only ever offered after the
   *  server has actually refused. */
  cancelOrder: (
    orderNumber: string,
    cancelWithoutRefund?: boolean,
  ) => Promise<{
    ok: boolean;
    refunded?: boolean;
    /** Paid outside Stripe, so nothing was reversed and the money goes back by hand. */
    manualRefundDue?: boolean;
    amountCents?: number;
    /** Stripe would not return the money. The one refusal she may override. */
    refundFailed?: boolean;
    error?: string;
  }>;
  recordRefund: (
    orderNumber: string,
    amountCents: number,
    reason: string,
    via: "manual" | "stripe",
  ) => Promise<RecordRefundResult>;
  removeOrderItems: (orderNumber: string, itemIds: string[]) => Promise<RemoveItemsResult>;
  updateSettings: (patch: Partial<AdminSettings>) => Promise<boolean>;
};

const AdminContext = createContext<AdminContextValue | null>(null);

/**
 * The words in a rejection worth putting in front of Michelle. Next redacts
 * anything a server action throws in production and hands the browser its own
 * "An error occurred in the Server Components render…" line with a digest
 * attached, so quoting that shows her React's message instead of ours. Only an
 * error raised in the browser itself, like a dropped connection, still carries
 * a message that means something.
 */
function readableError(e: unknown): string | null {
  if (!(e instanceof Error) || "digest" in e) return null;
  return e.message || null;
}

/**
 * The reason an action gave for refusing, or null when it did the work. An
 * action that answers with `{ ok: false, error }` is the only kind whose reason
 * survives to the browser, so a returned refusal counts as a failure here even
 * though the promise resolved. Actions that return nothing always read as null.
 */
function refusalMessage(result: unknown): string | null {
  if (typeof result !== "object" || result === null || !("ok" in result)) return null;
  const answer = result as { ok: unknown; error?: unknown };
  if (answer.ok !== false) return null;
  return typeof answer.error === "string" ? answer.error : "";
}

/**
 * Database-backed admin store. Loads on mount and re-pulls when the tab
 * regains focus, so an open admin tab never quietly serves stale orders. Each
 * mutation applies an optimistic local update, awaits the matching server
 * action, and on failure rolls the update back and surfaces the error in the
 * shell banner, so "saved" on screen always means saved in Postgres.
 */
export function AdminStoreProvider({ children }: { children: ReactNode }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [settings, setSettings] = useState<AdminSettings>(defaultSettings);
  const [hydrated, setHydrated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [loading, setLoading] = useState(false);
  const lastFetchAt = useRef(0);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await loadAdminData();
      setProducts(data.products);
      setOrders(data.orders);
      setSettings(data.settings);
      setLastUpdated(new Date());
      setError(null);
      // Only a load that actually returned counts as hydrated. Every admin page
      // reads this flag as "the real data is here now", and the settings form
      // mounts on it so its fields start from saved values. Setting it after a
      // failure handed all of them the empty arrays and the built-in default
      // settings and let them present that as fact, so the packing list said
      // there was nothing to pack and the settings form offered to save default
      // delivery zones over her own.
      //
      // Once true it stays true. A later refresh that fails keeps the last good
      // data on screen and raises the banner, rather than blanking a working
      // page.
      setHydrated(true);
    } catch (e: unknown) {
      setError(readableError(e) ?? "Failed to load admin data.");
    } finally {
      lastFetchAt.current = Date.now();
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Re-pull when the tab comes back to the foreground, throttled so quick
  // tab-switches don't hammer the server.
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastFetchAt.current < 30_000) return;
      void refresh();
    }
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [refresh]);

  /** Fire a server action for an optimistic update; roll back + surface on failure. */
  function persist(action: Promise<unknown>, rollback: () => void, what: string) {
    function failed(detail: string | null) {
      rollback();
      setError(
        // The reason is already a whole sentence with its own full stop, so
        // wrapping it in brackets produced a stray ".)." mid-message. Let it
        // stand as its own sentence.
        detail
          ? `${what} didn't save. ${detail} Nothing changed, please try again.`
          : `${what} didn't save. The change was undone, please try again.`,
      );
    }
    // An action can refuse two ways: by answering with its reason, which is the
    // only way the reason reaches the browser, or by throwing, which production
    // strips down to React's own wording. Both mean the change did not save.
    action.then(
      (result) => {
        const refusal = refusalMessage(result);
        if (refusal !== null) failed(refusal);
      },
      (e: unknown) => failed(readableError(e)),
    );
  }

  function patchProductLocal(id: string, patch: Partial<Product>) {
    setProducts((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }

  function patchOrderLocal(orderNumber: string, patch: Partial<AdminOrder>) {
    setOrders((prev) =>
      prev.map((o) => (o.orderNumber === orderNumber ? { ...o, ...patch } : o)),
    );
  }

  /** Optimistically patch one order, then persist with a snapshot rollback. */
  function persistOrderPatch(
    orderNumber: string,
    patch: Partial<AdminOrder>,
    action: Promise<unknown>,
    what: string,
  ) {
    const before = orders.find((o) => o.orderNumber === orderNumber);
    patchOrderLocal(orderNumber, patch);
    persist(
      action,
      () => {
        if (before) {
          setOrders((prev) => prev.map((o) => (o.orderNumber === orderNumber ? before : o)));
        }
      },
      what,
    );
  }

  function toggleAvailability(id: string) {
    const target = products.find((p) => p.id === id);
    if (!target) return;
    const isAvailable = !target.isAvailable;
    patchProductLocal(id, { isAvailable });
    persist(
      updateProductAction(id, { isAvailable }),
      () => patchProductLocal(id, { isAvailable: target.isAvailable }),
      "Availability",
    );
  }

  function toggleBestSeller(id: string) {
    const target = products.find((p) => p.id === id);
    if (!target) return;
    const isBestSeller = !target.isBestSeller;
    patchProductLocal(id, { isBestSeller });
    persist(
      updateProductAction(id, { isBestSeller }),
      () => patchProductLocal(id, { isBestSeller: target.isBestSeller }),
      "Best-seller flag",
    );
  }

  function toggleRecommended(id: string) {
    const target = products.find((p) => p.id === id);
    if (!target) return;
    const isRecommended = !target.isRecommended;
    patchProductLocal(id, { isRecommended });
    persist(
      updateProductAction(id, { isRecommended }),
      () => patchProductLocal(id, { isRecommended: target.isRecommended }),
      "Recommended flag",
    );
  }

  function updateProduct(id: string, patch: Partial<Product>) {
    const before = products.find((p) => p.id === id);
    patchProductLocal(id, patch);
    persist(
      updateProductAction(id, patch),
      () => {
        if (before) setProducts((prev) => prev.map((p) => (p.id === id ? before : p)));
      },
      "Product change",
    );
  }

  function addProduct(product: Product) {
    // DB assigns the real id. Insert the returned row so later edits match.
    void createProductAction(product)
      .then((created) => setProducts((prev) => [created, ...prev]))
      .catch((e: unknown) => setError(readableError(e) ?? "Failed to add product."));
  }

  function deleteProduct(id: string) {
    const before = products;
    setProducts((prev) => prev.filter((p) => p.id !== id));
    persist(deleteProductAction(id), () => setProducts(before), "Delete");
  }

  function updateOrderStatus(orderNumber: string, status: OrderStatus) {
    persistOrderPatch(
      orderNumber,
      { status },
      updateOrderStatusAction(orderNumber, status),
      `Status for ${orderNumber}`,
    );
  }

  function updatePaymentStatus(orderNumber: string, paymentStatus: PaymentStatus) {
    persistOrderPatch(
      orderNumber,
      // Mirror the server's paid_at stamp locally, or Insights would keep
      // bucketing the money on the day the order was placed until the next full
      // reload, which is the very thing paid_at was added to stop.
      {
        paymentStatus,
        paidAt: paymentStatus === "paid" ? new Date().toISOString() : null,
      },
      // Reaching paid counts tracked stock down and can hide a treat that just
      // sold out, and moving off paid puts both back, so pull the menu in again
      // once the server has done it. Without this the product editor keeps the
      // row it loaded before the sale and saves that count and that availability
      // back over the change.
      updatePaymentStatusAction(orderNumber, paymentStatus).then(refresh),
      `Payment status for ${orderNumber}`,
    );
  }

  function rescheduleOrder(orderNumber: string, date: string, timeWindow: string) {
    const before = orders.find((o) => o.orderNumber === orderNumber);
    if (before && before.scheduledDate === date && before.timeWindow === timeWindow) return;
    persistOrderPatch(
      orderNumber,
      { scheduledDate: date, timeWindow },
      rescheduleOrderAdminAction(orderNumber, date, timeWindow),
      `Reschedule for ${orderNumber}`,
    );
  }

  /**
   * Set or correct a delivery address. Optimistic like its neighbours, with one
   * extra step: while the order is unpaid the server re-prices delivery for the
   * new postal code, and the zone tiers are server-only, so the fee and total it
   * hands back are painted from its answer instead of guessed at here. The
   * result is passed straight on, so a refusal still rolls the whole patch back.
   */
  function setDeliveryAddress(
    orderNumber: string,
    address: { line1: string; unit: string; postalCode: string },
    timeWindow: string,
  ) {
    persistOrderPatch(
      orderNumber,
      {
        address: {
          line1: address.line1.trim(),
          unit: address.unit.trim() || undefined,
          postalCode: address.postalCode.trim(),
        },
        timeWindow: timeWindow.trim(),
      },
      setDeliveryAddressAction(orderNumber, address, timeWindow).then((result) => {
        if (result.ok) {
          patchOrderLocal(orderNumber, {
            deliveryFeeCents: result.deliveryFeeCents,
            totalCents: result.totalCents,
          });
        }
        return result;
      }),
      `Address for ${orderNumber}`,
    );
  }

  function updateOwnerNote(orderNumber: string, note: string) {
    const trimmed = note.trim();
    const before = orders.find((o) => o.orderNumber === orderNumber);
    if (before && (before.ownerNote ?? "") === trimmed) return; // nothing changed
    persistOrderPatch(
      orderNumber,
      { ownerNote: trimmed || undefined },
      updateOwnerNoteAction(orderNumber, trimmed),
      `Note for ${orderNumber}`,
    );
  }

  async function addManualOrder(input: ManualOrderInput): Promise<ManualOrderResult> {
    const result = await createManualOrderAction(input);
    // Pull the new order in so it appears in the list and every prep tool.
    if (result.ok) await refresh();
    return result;
  }

  async function cancelOrder(orderNumber: string, cancelWithoutRefund = false) {
    const result = await cancelOrderAction(orderNumber, cancelWithoutRefund);
    if (result.ok) {
      setOrders((prev) =>
        prev.map((o) =>
          o.orderNumber === orderNumber
            ? {
                ...o,
                status: "cancelled",
                paymentStatus: result.refunded ? "refunded" : o.paymentStatus,
              }
            : o,
        ),
      );
      // A cancel does more than move two fields. It puts tracked stock back,
      // which can flip a treat that auto-hid at zero back to available, it
      // returns loyalty points, and it writes down what Stripe sent back. None
      // of that is in the local patch above, so without a re-pull the menu keeps
      // showing sold out on something that is orderable again and the money
      // figures on screen stay at what they were before the refund.
      await refresh();
      // manualRefundDue and amountCents carry the "no Stripe payment to reverse,
      // send it back yourself" case, so pass them through instead of dropping
      // them and leaving the panel unable to say how much is owed.
      return {
        ok: true,
        refunded: result.refunded,
        manualRefundDue: result.manualRefundDue,
        amountCents: result.amountCents,
      };
    }
    // refundFailed marks the one refusal she is allowed to override, so it has
    // to survive the trip back. Dropped here, the panel could never offer the
    // way out and the order stayed stuck for good.
    return { ok: false, error: result.error, refundFailed: result.refundFailed };
  }

  /** Not optimistic: the server refuses a refund that would take back more than
   *  the order charged, so wait to hear that it was accepted before adding it. */
  async function recordRefund(
    orderNumber: string,
    amountCents: number,
    reason: string,
    via: "manual" | "stripe",
  ): Promise<RecordRefundResult> {
    const result = await recordRefundAction(orderNumber, amountCents, reason, via);
    if (result.ok) {
      setOrders((prev) =>
        prev.map((o) =>
          o.orderNumber === orderNumber
            ? { ...o, refundedCents: (o.refundedCents ?? 0) + amountCents }
            : o,
        ),
      );
    }
    return result;
  }

  /** Also not optimistic: the database works out what the removed lines were
   *  worth and refuses once the order is baking, so the totals here follow its
   *  answer rather than guessing at one. */
  async function removeOrderItems(
    orderNumber: string,
    itemIds: string[],
  ): Promise<RemoveItemsResult> {
    const result = await removeOrderItemsAction(orderNumber, itemIds);
    if (result.ok) {
      const removed = new Set(itemIds);
      setOrders((prev) =>
        prev.map((o) =>
          o.orderNumber === orderNumber
            ? {
                ...o,
                items: o.items.filter((item) => !removed.has(item.key)),
                // Floored at zero the same way the removal does it in Postgres,
                // so the panel and the row can never disagree about the total.
                subtotalCents: Math.max(0, o.subtotalCents - result.removedCents),
                totalCents: Math.max(0, o.totalCents - result.removedCents),
              }
            : o,
        ),
      );
    }
    return result;
  }

  async function updateSettings(patch: Partial<AdminSettings>): Promise<boolean> {
    const before = settings;
    setSettings((prev) => ({ ...prev, ...patch }));
    try {
      await updateSettingsAction(patch);
      return true;
    } catch (e: unknown) {
      setSettings(before);
      const detail = readableError(e);
      setError(
        detail
          ? `Settings didn't save (${detail}). Your changes were undone.`
          : "Settings didn't save. Your changes were undone, please try again.",
      );
      return false;
    }
  }

  const value: AdminContextValue = {
    products,
    orders,
    settings,
    hydrated,
    error,
    refresh,
    loading,
    lastUpdated,
    toggleAvailability,
    toggleBestSeller,
    toggleRecommended,
    updateProduct,
    addProduct,
    deleteProduct,
    updateOrderStatus,
    updatePaymentStatus,
    updateOwnerNote,
    rescheduleOrder,
    setDeliveryAddress,
    addManualOrder,
    cancelOrder,
    recordRefund,
    removeOrderItems,
    updateSettings,
  };

  return <AdminContext.Provider value={value}>{children}</AdminContext.Provider>;
}

export function useAdmin(): AdminContextValue {
  const context = useContext(AdminContext);
  if (!context) throw new Error("useAdmin must be used within an AdminStoreProvider");
  return context;
}
