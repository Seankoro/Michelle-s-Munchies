import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { fetchBoxBySlug } from "@/lib/boxes";
import { fetchStoreSettings } from "@/lib/settings";
import { BoxBuilder } from "@/components/product/BoxBuilder";

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const box = await fetchBoxBySlug(slug);
  return { title: box ? box.name : "Not found" };
}

export default async function BoxDetailPage({ params }: Params) {
  const { slug } = await params;
  if (!(await fetchStoreSettings()).features.buildABox) notFound();
  const box = await fetchBoxBySlug(slug);
  if (!box) notFound();

  return (
    <main className="mx-auto max-w-3xl px-6 py-10 lg:px-10">
      <Link href="/build-a-box" className="text-sm font-semibold text-rose transition hover:text-rose-deep">
        ← Back to boxes
      </Link>
      <h1 className="mt-6 font-display text-4xl font-semibold">{box.name}</h1>
      <p className="mt-2 text-muted">Pick any {box.itemCount} treats to fill your box.</p>
      {box.eligibleProducts.length === 0 ? (
        <p className="mt-8 text-muted">No treats are available for this box right now.</p>
      ) : (
        <div className="mt-6">
          <BoxBuilder box={box} />
        </div>
      )}
    </main>
  );
}
