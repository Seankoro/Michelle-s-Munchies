import Link from "next/link";
import Image from "next/image";
import { formatPrice } from "@/lib/catalog";
import { ImagePlaceholder } from "@/components/ui/ImagePlaceholder";
import type { Bundle } from "@/lib/types";

export function BundleCard({ bundle }: { bundle: Bundle }) {
  return (
    <Link
      href={`/bundles/${bundle.slug}`}
      className="group flex flex-col overflow-hidden rounded-2xl border border-line bg-white transition hover:border-rose"
    >
      <div className="relative aspect-square w-full overflow-hidden">
        {bundle.imageUrl ? (
          <Image
            src={bundle.imageUrl}
            alt={bundle.name}
            fill
            sizes="(max-width: 640px) 100vw, 25vw"
            className="object-cover transition group-hover:scale-105"
          />
        ) : (
          <ImagePlaceholder aspect="square" label="Bundle photo" icon="🎀" />
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-4">
        <h3 className="font-display text-lg font-semibold">{bundle.name}</h3>
        {bundle.description && (
          <p className="line-clamp-2 text-sm text-muted">{bundle.description}</p>
        )}
        <p className="mt-auto pt-2 font-semibold text-ink">{formatPrice(bundle.priceCents)}</p>
      </div>
    </Link>
  );
}
