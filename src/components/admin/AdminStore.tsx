"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Product } from "@/lib/types";
import type { AdminOrder, OrderStatus, PaymentStatus } from "@/lib/order";
import type { FeatureFlags, NotePrompt } from "@/lib/settings";
import {
  cancelOrderAction,
  createProductAction,
  deleteProductAction,
  loadAdminData,
  updateOrderStatusAction,
  updatePaymentStatusAction,
  updateProductAction,
  updateSettingsAction,
} from "@/lib/admin-actions";

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
  pointsPerDollar: 1,
  pointValueCents: 5,
  referralReferrerPoints: 50,
  referralRefereePoints: 30,
  features: {
    rewards: true,
    wishlist: true,
    reviews: true,
    promos: true,
    gifting: true,
    referrals: true,
    buildABox: true,
    bundles: true,
    spendGift: true,
    backInStock: true,
    photoReviews: true,
    cartSharing: true,
    wishlistSharing: true,
    instagram: true,
    birthdayRewards: true,
    abandonedCart: true,
    structuredNotes: true,
    orderChanges: true,
    newsletter: true,
    drops: true,
    dietaryPrefs: true,
  },
};

type AdminContextValue = {
  products: Product[];
  orders: AdminOrder[];
  settings: AdminSettings;
  hydrated: boolean;
  error: string | null;
  toggleAvailability: (id: string) => void;
  toggleBestSeller: (id: string) => void;
  toggleRecommended: (id: string) => void;
  updateProduct: (id: string, patch: Partial<Product>) => void;
  addProduct: (product: Product) => void;
  deleteProduct: (id: string) => void;
  updateOrderStatus: (orderNumber: string, status: OrderStatus) => void;
  updatePaymentStatus: (orderNumber: string, paymentStatus: PaymentStatus) => void;
  cancelOrder: (orderNumber: string) => Promise<{ ok: boolean; refunded?: boolean; error?: string }>;
  updateSettings: (patch: Partial<AdminSettings>) => void;
};

const AdminContext = createContext<AdminContextValue | null>(null);

/**
 * Database-backed admin store. Reads everything once on mount via a server
 * action. Each mutation applies an optimistic local update and fires the
 * matching server action, which writes to Postgres with the service-role key.
 */
export function AdminStoreProvider({ children }: { children: ReactNode }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [settings, setSettings] = useState<AdminSettings>(defaultSettings);
  const [hydrated, setHydrated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    loadAdminData()
      .then((data) => {
        if (!active) return;
        setProducts(data.products);
        setOrders(data.orders);
        setSettings(data.settings);
        setHydrated(true);
      })
      .catch((e: unknown) => {
        if (!active) return;
        setError(e instanceof Error ? e.message : "Failed to load admin data.");
        setHydrated(true);
      });
    return () => {
      active = false;
    };
  }, []);

  function patchProductLocal(id: string, patch: Partial<Product>) {
    setProducts((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }

  function toggleAvailability(id: string) {
    const target = products.find((p) => p.id === id);
    if (!target) return;
    const isAvailable = !target.isAvailable;
    patchProductLocal(id, { isAvailable });
    void updateProductAction(id, { isAvailable });
  }

  function toggleBestSeller(id: string) {
    const target = products.find((p) => p.id === id);
    if (!target) return;
    const isBestSeller = !target.isBestSeller;
    patchProductLocal(id, { isBestSeller });
    void updateProductAction(id, { isBestSeller });
  }

  function toggleRecommended(id: string) {
    const target = products.find((p) => p.id === id);
    if (!target) return;
    const isRecommended = !target.isRecommended;
    patchProductLocal(id, { isRecommended });
    void updateProductAction(id, { isRecommended });
  }

  function updateProduct(id: string, patch: Partial<Product>) {
    patchProductLocal(id, patch);
    void updateProductAction(id, patch);
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
    setProducts((prev) => prev.filter((p) => p.id !== id));
    void deleteProductAction(id);
  }

  function updateOrderStatus(orderNumber: string, status: OrderStatus) {
    setOrders((prev) =>
      prev.map((o) => (o.orderNumber === orderNumber ? { ...o, status } : o)),
    );
    void updateOrderStatusAction(orderNumber, status);
  }

  function updatePaymentStatus(orderNumber: string, paymentStatus: PaymentStatus) {
    setOrders((prev) =>
      prev.map((o) => (o.orderNumber === orderNumber ? { ...o, paymentStatus } : o)),
    );
    void updatePaymentStatusAction(orderNumber, paymentStatus);
  }

  async function cancelOrder(orderNumber: string) {
    const result = await cancelOrderAction(orderNumber);
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
      return { ok: true, refunded: result.refunded };
    }
    return { ok: false, error: result.error };
  }

  function updateSettings(patch: Partial<AdminSettings>) {
    setSettings((prev) => ({ ...prev, ...patch }));
    void updateSettingsAction(patch);
  }

  const value: AdminContextValue = {
    products,
    orders,
    settings,
    hydrated,
    error,
    toggleAvailability,
    toggleBestSeller,
    toggleRecommended,
    updateProduct,
    addProduct,
    deleteProduct,
    updateOrderStatus,
    updatePaymentStatus,
    cancelOrder,
    updateSettings,
  };

  return <AdminContext.Provider value={value}>{children}</AdminContext.Provider>;
}

export function useAdmin(): AdminContextValue {
  const context = useContext(AdminContext);
  if (!context) throw new Error("useAdmin must be used within an AdminStoreProvider");
  return context;
}
