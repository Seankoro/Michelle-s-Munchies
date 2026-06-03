import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { fetchStoreSettings } from "@/lib/settings";
import { fetchSharedFavourites } from "@/lib/wishlist-share";
import { formatPrice } from "@/lib/catalog";
import { ImagePlaceholder } from "@/components/ui/ImagePlaceholder";
import { AddAllFavouritesButton } from "@/components/account/AddAllFavouritesButton";

export const metadata: Metadata = { title: "A shared wishlist" };

type Params = { params: Promise<{ token: string }> };

export default async function SharedWishlistPage({ params }: Params) {
  if (!(await fetchStoreSettings()).features.wishlistSharing) notFound();
  const { token } = await params;
  const favourites = await fetchSharedFavourites(token);
  if (!favourites) notFound();

  return (
    <main className="mx-auto max-w-none px-6 py-10 lg:px-10">
      <h1 className="font-display text-4xl font-semibold">A wishlist of treats 🎀</h1>
      <p className="mt-2 text-muted">Someone shared their favourite Michelle&rsquo;s Munchies bakes with you.</p>

      {favourites.length === 0 ? (
        <p className="mt-8 text-muted">This wishlist is empty right now.</p>
      ) : (
        <>
          <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {favourites.map((fav) => (
              <Link
                key={fav.id}
                href={`/menu/${fav.slug}`}
                className="group flex flex-col overflow-hidden rounded-2xl border border-line bg-white transition hover:border-rose"
              >
                <div className="relative aspect-square w-full overflow-hidden">
                  {fav.imageUrl ? (
                    <Image
                      src={fav.imageUrl}
                      alt={fav.name}
                      fill
                      sizes="(max-width: 640px) 100vw, 25vw"
                      className="object-cover transition group-hover:scale-105"
                    />
                  ) : (
                    <ImagePlaceholder aspect="square" label="Treat" icon="🧁" />
                  )}
                </div>
                <div className="flex flex-1 flex-col gap-1 p-4">
                  <h3 className="font-display text-lg font-semibold">{fav.name}</h3>
                  <p className="mt-auto pt-2 font-semibold text-ink">{formatPrice(fav.priceCents)}</p>
                </div>
              </Link>
            ))}
          </div>
          <div className="mt-8">
            <AddAllFavouritesButton items={favourites} />
          </div>
        </>
      )}
    </main>
  );
}
