import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { fetchBundleBySlug } from "@/lib/bundles";
import { fetchStoreSettings } from "@/lib/settings";
import { formatPrice } from "@/lib/catalog";
import { ImagePlaceholder } from "@/components/ui/ImagePlaceholder";
import { AddBundleButton } from "@/components/product/AddBundleButton";

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const bundle = await fetchBundleBySlug(slug);
  return { title: bundle ? bundle.name : "Not found", description: bundle?.description ?? undefined };
}

export default async function BundleDetailPage({ params }: Params) {
  const { slug } = await params;
  if (!(await fetchStoreSettings()).features.bundles) notFound();
  const bundle = await fetchBundleBySlug(slug);
  if (!bundle) notFound();

  return (
    <main className="mx-auto max-w-none px-6 py-10 lg:px-10">
      <Link href="/bundles" className="text-sm font-semibold text-rose transition hover:text-rose-deep">
        ← Back to bundles
      </Link>

      <div className="mt-6 grid gap-10 lg:grid-cols-2">
        <div className="relative aspect-square w-full overflow-hidden rounded-2xl">
          {bundle.imageUrl ? (
            <Image
              src={bundle.imageUrl}
              alt={bundle.name}
              fill
              sizes="(max-width: 1024px) 100vw, 50vw"
              className="object-cover"
              priority
            />
          ) : (
            <ImagePlaceholder aspect="square" label="Bundle photo" icon="🎀" />
          )}
        </div>

        <div>
          <h1 className="font-display text-4xl font-semibold">{bundle.name}</h1>
          <p className="mt-2 text-xl font-semibold text-ink">{formatPrice(bundle.priceCents)}</p>
          {bundle.description && <p className="mt-4 text-muted">{bundle.description}</p>}

          <h2 className="mt-6 text-sm font-semibold text-ink">What&rsquo;s inside</h2>
          <ul className="mt-2 flex flex-col gap-1 text-sm text-muted">
            {bundle.items.map((item, index) => (
              <li key={index} className="flex gap-2">
                <span className="font-semibold text-ink">{item.quantity}×</span>
                {item.productName}
              </li>
            ))}
          </ul>

          <div className="mt-8">
            <AddBundleButton bundle={bundle} />
          </div>
        </div>
      </div>
    </main>
  );
}
