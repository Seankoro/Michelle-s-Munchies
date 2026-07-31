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
  clearDepositOwedAction,
  createManualOrderAction,
  createProductAction,
  deleteProductAction,
  loadAdminData,
  recordDepositAction,
  recordRefundAction,
  removeOrderItemsAction,
  rescheduleOrderAdminAction,
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
  recordDeposit: (orderNumber: string, cents: number) => void;
  addManualOrder: (input: ManualOrderInput) => Promise<ManualOrderResult>;
  /** `depositReturned` answers whether a deposit already went back to the
   *  customer. Left off it means still owed, which keeps the money visible. */
  cancelOrder: (
    orderNumber: string,
    depositReturned?: boolean,
  ) => Promise<{
    ok: boolean;
    refunded?: boolean;
    /** Paid outside Stripe, so nothing was reversed and the money goes back by hand. */
    manualRefundDue?: boolean;
    amountCents?: number;
    error?: string;
  }>;
  clearDepositOwed: (orderNumber: string) => void;
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
  const lastFetchAt = useRef(0);

  const refresh = useCallback(async () => {
    try {
      const data = await loadAdminData();
      setProducts(data.products);
      setOrders(data.orders);
      setSettings(data.settings);
      setLastUpdated(new Date());
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load admin data.");
    } finally {
      lastFetchAt.current = Date.now();
    }
  }, []);

  useEffect(() => {
    void refresh().finally(() => setHydrated(true));
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
    action.catch((e: unknown) => {
      rollback();
      setError(
        e instanceof Error
          ? `${what} didn't save (${e.message}). The change was undone, please try again.`
          : `${what} didn't save. The change was undone, please try again.`,
      );
    });
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
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : "Failed to add product."),
      );
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
      updatePaymentStatusAction(orderNumber, paymentStatus),
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

  function recordDeposit(orderNumber: string, cents: number) {
    const depositCents = cents > 0 ? Math.round(cents) : null;
    persistOrderPatch(
      orderNumber,
      { depositCents },
      recordDepositAction(orderNumber, cents),
      `Deposit for ${orderNumber}`,
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

  async function cancelOrder(orderNumber: string, depositReturned = false) {
    const result = await cancelOrderAction(orderNumber, depositReturned);
    if (result.ok) {
      setOrders((prev) =>
        prev.map((o) =>
          o.orderNumber === orderNumber
            ? {
                ...o,
                status: "cancelled",
                paymentStatus: result.refunded ? "refunded" : o.paymentStatus,
                // Same sum the server records: a deposit she is still holding
                // becomes money owed back the moment the order is cancelled.
                depositOutstandingCents:
                  !depositReturned && o.depositCents != null && o.depositCents > 0
                    ? o.depositCents
                    : null,
              }
            : o,
        ),
      );
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
    return { ok: false, error: result.error };
  }

  function clearDepositOwed(orderNumber: string) {
    persistOrderPatch(
      orderNumber,
      { depositOutstandingCents: null },
      clearDepositOwedAction(orderNumber),
      `Deposit owed on ${orderNumber}`,
    );
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
      setError(
        e instanceof Error
          ? `Settings didn't save (${e.message}). Your changes were undone.`
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
    recordDeposit,
    addManualOrder,
    cancelOrder,
    clearDepositOwed,
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
