import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { fetchActiveBundles } from "@/lib/bundles";
import { fetchStoreSettings } from "@/lib/settings";
import { BundleCard } from "@/components/product/BundleCard";

export const metadata: Metadata = {
  title: "Bundles",
  description: "Curated bundles from Michelle's Munchies, ready to gift or share.",
};

export default async function BundlesPage() {
  if (!(await fetchStoreSettings()).features.bundles) notFound();
  const bundles = await fetchActiveBundles();

  return (
    <main className="mx-auto max-w-none px-6 py-10 lg:px-10">
      <h1 className="font-display text-4xl font-semibold">Bundles</h1>
      <p className="mt-2 text-muted">
        Curated sets, ready to gift or share.
      </p>
      {bundles.length === 0 ? (
        <p className="mt-8 text-muted">No bundles available right now. Check back soon!</p>
      ) : (
        <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {bundles.map((bundle) => (
            <BundleCard key={bundle.id} bundle={bundle} />
          ))}
        </div>
      )}
    </main>
  );
}
