"use client";

import { createContext, useContext, type ReactNode } from "react";
import { ALL_FEATURES_ON, type FeatureFlags } from "@/lib/feature-flags";

const FeaturesContext = createContext<FeatureFlags | null>(null);

/** Seeded with the flags fetched server-side in the root layout, so there's no flash. */
export function FeaturesProvider({
  value,
  children,
}: {
  value: FeatureFlags;
  children: ReactNode;
}) {
  return <FeaturesContext.Provider value={value}>{children}</FeaturesContext.Provider>;
}

/** Read feature flags in client components. Falls back to all-on if no provider. */
export function useFeatures(): FeatureFlags {
  return useContext(FeaturesContext) ?? ALL_FEATURES_ON;
}

const PaymentsContext = createContext(false);

/**
 * Whether checkout hands the customer to Stripe at the end, seeded server-side
 * from whether a Stripe key is configured at all.
 *
 * Checkout used to say "No payment is taken here" and promise PayNow details
 * over WhatsApp, while the action behind it sent the customer to a hosted Stripe
 * page whenever the key was set. Nothing in the page knew which was true, so the
 * wording was only ever correct by accident. Now it follows the configuration.
 */
export function PaymentsProvider({
  value,
  children,
}: {
  value: boolean;
  children: ReactNode;
}) {
  return <PaymentsContext.Provider value={value}>{children}</PaymentsContext.Provider>;
}

/** True when the customer pays online at the end of checkout. */
export function usePaymentsEnabled(): boolean {
  return useContext(PaymentsContext);
}
