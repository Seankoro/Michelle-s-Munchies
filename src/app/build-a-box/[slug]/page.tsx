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
  if (!box) return { title: "Not found" };
  // A box carries no photo of its own, so borrow the first treat that can go in
  // it. That is what the box actually is, and it beats the generic bakery card
  // this link shows in a WhatsApp chat today.
  const description = `Pick any ${box.itemCount} treats for ${(box.priceCents / 100).toFixed(2)} SGD.`;
  const cover = box.eligibleProducts.find((p) => p.imageUrls?.length)?.imageUrls?.[0];
  return {
    title: box.name,
    description,
    alternates: { canonical: `/build-a-box/${box.slug}` },
    openGraph: {
      title: box.name,
      description,
      type: "website",
      // Falls back to the shop card rather than nothing. Next replaces the
      // root openGraph wholesale once a route defines its own, so leaving this
      // undefined strips the image from the preview entirely, which is worse
      // than the generic card it was meant to improve on. No treat carries a
      // photo yet, so today every one of these uses the fallback.
      images: cover ? [cover] : ["/og.png"],
    },
  };
}

export default async function BoxDetailPage({ params }: Params) {
  const { slug } = await params;
  if (!(await fetchStoreSettings()).features.buildABox) notFound();
  const box = await fetchBoxBySlug(slug);
  if (!box) notFound();

  return (
    <main className="mx-auto max-w-3xl px-6 py-10 lg:px-10">
      <Link href="/build-a-box" className="text-sm font-semibold text-rose-ink transition hover:text-rose">
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
