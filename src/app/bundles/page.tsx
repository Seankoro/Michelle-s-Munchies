import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { fetchActiveBundles } from "@/lib/bundles";
import { fetchStoreSettings } from "@/lib/settings";
import { BundleCard } from "@/components/product/BundleCard";
import { Reveal } from "@/components/ui/Reveal";

export const metadata: Metadata = {
  title: "Bundles",
  description: "Curated bundles from Michelle's Munchies, ready to gift or share.",
};

export default async function BundlesPage() {
  if (!(await fetchStoreSettings()).features.bundles) notFound();
  const bundles = await fetchActiveBundles();

  return (
    <main className="mx-auto max-w-none px-6 py-12 lg:px-10">
      <Reveal>
        <header className="text-center">
          <h1 className="font-display text-4xl font-semibold sm:text-5xl">Bundles</h1>
          <p className="mx-auto mt-3 max-w-xl text-muted">Curated sets, ready to gift or share.</p>
        </header>
      </Reveal>
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
