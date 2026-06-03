"use client";

import { createContext, useContext, type ReactNode } from "react";
import { ALL_FEATURES_ON, type FeatureFlags } from "@/lib/feature-flags";

const FeaturesContext = createContext<FeatureFlags | null>(null);

/** Seeded with the flags fetched server-side in the root layout (no flash). */
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
