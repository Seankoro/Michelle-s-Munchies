import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { fetchActiveBoxTemplates } from "@/lib/boxes";
import { fetchStoreSettings } from "@/lib/settings";
import { formatPrice } from "@/lib/catalog";
import { Reveal } from "@/components/ui/Reveal";

export const metadata: Metadata = {
  title: "Build a box",
  description: "Mix and match your own box of treats from Michelle's Munchies.",
};

export default async function BuildABoxPage() {
  if (!(await fetchStoreSettings()).features.buildABox) notFound();
  const boxes = await fetchActiveBoxTemplates();

  return (
    <main className="mx-auto max-w-none px-6 py-12 lg:px-10">
      <Reveal>
        <header className="text-center">
          <h1 className="font-display text-4xl font-semibold sm:text-5xl">Build a box</h1>
          <p className="mx-auto mt-3 max-w-xl text-muted">
            Mix and match your favourites. Pick your treats for one price.
          </p>
        </header>
      </Reveal>
      {boxes.length === 0 ? (
        <p className="mt-8 text-muted">No boxes available right now. Check back soon!</p>
      ) : (
        <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {boxes.map((box) => (
            <Link
              key={box.id}
              href={`/build-a-box/${box.slug}`}
              className="flex flex-col gap-2 rounded-2xl border border-line bg-white p-6 transition hover:border-rose"
            >
              <span className="text-3xl" aria-hidden="true">
                🎀
              </span>
              <h2 className="font-display text-xl font-semibold">{box.name}</h2>
              <p className="text-sm text-muted">Pick any {box.itemCount} treats.</p>
              <p className="mt-auto pt-2 font-semibold text-ink">{formatPrice(box.priceCents)}</p>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
