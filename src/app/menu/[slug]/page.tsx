import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { allergenMeta, formatPrice } from "@/lib/catalog";
import { fetchProductBySlug, fetchRelatedProducts, isUpcoming } from "@/lib/products";
import { fetchStoreSettings } from "@/lib/settings";
import { ImagePlaceholder } from "@/components/ui/ImagePlaceholder";
import { Badge } from "@/components/ui/Badge";
import { OptionPicker } from "@/components/product/OptionPicker";
import { FlavourBoxPicker } from "@/components/product/FlavourBoxPicker";
import { BackToMenuLink } from "@/components/product/BackToMenuLink";
import { AllergenChips } from "@/components/product/AllergenChips";
import { DietaryTags } from "@/components/product/DietaryTags";
import { SubstitutionNote } from "@/components/product/SubstitutionNote";
import { NotifyBackInStock } from "@/components/product/NotifyBackInStock";
import { DropCountdown } from "@/components/product/DropCountdown";
import { ProductCard } from "@/components/product/ProductCard";
import { ShareButton } from "@/components/product/ShareButton";
import { FavouriteButton } from "@/components/wishlist/FavouriteButton";
import { Stars } from "@/components/product/Stars";
import { ReviewForm } from "@/components/product/ReviewForm";
import { fetchReviews, getReviewContext } from "@/lib/reviews";
import { formatLongDate } from "@/lib/order";
import { jsonLd } from "@/lib/json-ld";
import { Reveal } from "@/components/ui/Reveal";

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const product = await fetchProductBySlug(slug);
  if (!product) return { title: "Not found" };
  return {
    title: product.name,
    description: product.shortDescription,
    alternates: { canonical: `/menu/${product.slug}` },
    // Most of these links are pasted into a WhatsApp chat, and without this the
    // preview is the same generic bakery card for every treat. The photo is the
    // whole pitch, so it has to be the one in the card.
    openGraph: {
      title: product.name,
      description: product.shortDescription,
      type: "website",
      images: product.imageUrls?.length ? [product.imageUrls[0]] : undefined,
    },
  };
}

export default async function ProductDetailPage({ params }: Params) {
  const { slug } = await params;
  // The middleware's per-request CSP nonce, so the JSON-LD script below stays
  // allowed now that inline scripts without a nonce are refused.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const product = await fetchProductBySlug(slug);
  if (!product) notFound();

  // Related products and settings both depend only on the product, so fetch them
  // together instead of in series.
  const [related, settings] = await Promise.all([
    fetchRelatedProducts(product),
    fetchStoreSettings(),
  ]);
  // Only touch reviews when the feature is on, so a disabled store never renders
  // (or emits star JSON-LD for) content the page keeps hidden. Both review reads
  // share that gate, so run them together too.
  let reviews: Awaited<ReturnType<typeof fetchReviews>> = [];
  let reviewCtx = {
    signedIn: false,
    canReview: false,
    existing: null,
  } as Awaited<ReturnType<typeof getReviewContext>>;
  if (settings.features.reviews) {
    [reviews, reviewCtx] = await Promise.all([
      fetchReviews(product.id),
      getReviewContext(product.id),
    ]);
  }
  const avgRating = reviews.length
    ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length
    : 0;
  const photoCount = product.photoCount ?? 1;
  const allergenText = product.allergens.map((a) => allergenMeta[a].label.toLowerCase());
  const leadTime = settings.leadTimeDays;

  // Product structured data so search results can show price, stock, and stars.
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const productJsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: product.shortDescription,
    url: `${siteUrl}/menu/${product.slug}`,
    ...(product.imageUrls && product.imageUrls.length > 0 ? { image: product.imageUrls } : {}),
    // A product with options has no single price, and the page says so by
    // showing a "from" price. Declaring one exact figure to Google invites a
    // rich result quoting a price the customer cannot actually buy at.
    offers: (() => {
      const availability = product.isAvailable
        ? "https://schema.org/InStock"
        : "https://schema.org/OutOfStock";
      const url = `${siteUrl}/menu/${product.slug}`;
      const low = product.basePriceCents;
      // The dearest reachable combination, taking the priciest value in each
      // group that has one.
      const high = (product.options ?? []).reduce(
        (total, option) =>
          total + Math.max(0, ...(option.values ?? []).map((v) => v.priceDeltaCents ?? 0)),
        low,
      );
      if (high <= low) {
        return {
          "@type": "Offer",
          priceCurrency: "SGD",
          price: (low / 100).toFixed(2),
          availability,
          url,
        };
      }
      return {
        "@type": "AggregateOffer",
        priceCurrency: "SGD",
        lowPrice: (low / 100).toFixed(2),
        highPrice: (high / 100).toFixed(2),
        availability,
        url,
      };
    })(),
    ...(reviews.length > 0
      ? {
          aggregateRating: {
            "@type": "AggregateRating",
            ratingValue: avgRating.toFixed(1),
            reviewCount: reviews.length,
          },
        }
      : {}),
  };

  return (
    <main className="mx-auto max-w-none px-6 py-10 lg:px-10">
      <script
        type="application/ld+json"
        nonce={nonce}
        dangerouslySetInnerHTML={{ __html: jsonLd(productJsonLd) }}
      />
      <BackToMenuLink />

      <div className="mt-6 grid gap-10 lg:grid-cols-2">
        {/* Gallery */}
        <div>
          {product.imageUrls && product.imageUrls.length > 0 ? (
            <>
              <div className="relative aspect-square w-full overflow-hidden rounded-2xl">
                <Image
                  src={product.imageUrls[0]}
                  alt={product.name}
                  fill
                  sizes="(max-width: 1024px) 100vw, 50vw"
                  className="object-cover"
                  priority
                />
              </div>
              {product.imageUrls.length > 1 && (
                <div className="mt-3 grid grid-cols-3 gap-3">
                  {product.imageUrls.slice(1, 4).map((url, index) => (
                    <div
                      key={index}
                      className="relative aspect-square overflow-hidden rounded-2xl"
                    >
                      <Image
                        src={url}
                        alt={`${product.name} photo ${index + 2}`}
                        fill
                        sizes="33vw"
                        className="object-cover"
                      />
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              <ImagePlaceholder aspect="square" label="Main product photo" icon="📷" />
              {photoCount > 1 && (
                <div className="mt-3 grid grid-cols-3 gap-3">
                  {Array.from({ length: Math.min(photoCount, 3) }).map((_, index) => (
                    <ImagePlaceholder
                      key={index}
                      aspect="square"
                      label={`Photo ${index + 1}`}
                      icon="📷"
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Info */}
        <div>
          <div className="flex flex-wrap gap-2">
            {product.isBestSeller && <Badge tone="bestseller">★ Best seller</Badge>}
            {product.isRecommended && <Badge tone="recommended">Recommended</Badge>}
            {!product.isAvailable && <Badge tone="soldout">Sold out</Badge>}
          </div>

          <div className="mt-3 flex items-start justify-between gap-3">
            <h1 className="font-display text-4xl font-semibold">{product.name}</h1>
            <FavouriteButton
              productId={product.id}
              soldOut={!product.isAvailable}
              className="mt-1 shrink-0"
            />
          </div>
          <p className="mt-2 text-xl font-semibold text-ink">
            {product.options.length > 0 && (
              <span className="text-base font-normal text-muted">from </span>
            )}
            {formatPrice(product.basePriceCents)}
          </p>
          {settings.features.reviews && reviews.length > 0 && (
            <a
              href="#reviews"
              className="mt-2 inline-flex items-center gap-2 text-sm text-muted transition hover:text-ink"
            >
              <Stars value={avgRating} /> {avgRating.toFixed(1)} · {reviews.length} review
              {reviews.length === 1 ? "" : "s"}
            </a>
          )}
          <p className="mt-4 text-muted">{product.longDescription}</p>

          <p className="mt-4 rounded-xl bg-blush-soft/60 px-4 py-3 text-sm text-rose-ink">
            🎀 Baked to order. Please order at least {leadTime} day{leadTime === 1 ? "" : "s"} ahead.
          </p>

          {settings.features.drops && isUpcoming(product) ? (
            <div className="mt-6 flex flex-col gap-4">
              <DropCountdown availableFrom={product.availableFrom as string} />
              <NotifyBackInStock productId={product.id} mode="drop" />
            </div>
          ) : (
            <>
              <div className="mt-6">
                {product.flavourBox ? (
                  <FlavourBoxPicker product={product} />
                ) : (
                  <OptionPicker product={product} allowPersonalisation />
                )}
              </div>
              {!product.isAvailable && <NotifyBackInStock productId={product.id} />}
            </>
          )}

          {product.options.length > 0 && <SubstitutionNote className="mt-4" />}

          <DietaryTags tags={product.dietaryTags} className="mt-6" />

          {/* Allergens, icons and a written line, safety-critical and never hidden */}
          {product.allergens.length > 0 && (
            <div className="mt-6">
              <h2 className="text-sm font-semibold text-ink">Allergens</h2>
              <div className="mt-2 flex items-center gap-3">
                <AllergenChips allergens={product.allergens} size="md" />
              </div>
              <p className="mt-2 text-sm text-muted">
                Contains {allergenText.join(", ")}.
              </p>
            </div>
          )}

          {product.ingredients && product.ingredients.length > 0 && (
            <details className="mt-4 rounded-xl border border-line bg-white p-4">
              <summary className="cursor-pointer text-sm font-semibold text-ink">
                Ingredients
              </summary>
              <p className="mt-2 text-sm text-muted">
                {product.ingredients.map((i) => i.name).join(", ")}.
              </p>
            </details>
          )}

          {(product.storageInfo || product.servingInfo) && (
            <dl className="mt-4 space-y-1 text-sm text-muted">
              {product.servingInfo && (
                <div className="flex gap-2">
                  <dt className="font-semibold text-ink">Serving:</dt>
                  <dd>{product.servingInfo}</dd>
                </div>
              )}
              {product.storageInfo && (
                <div className="flex gap-2">
                  <dt className="font-semibold text-ink">Storage:</dt>
                  <dd>{product.storageInfo}</dd>
                </div>
              )}
            </dl>
          )}

          <div className="mt-6">
            <ShareButton title={product.name} text={`Look at this from Michelle's Munchies: ${product.name}`} />
          </div>
        </div>
      </div>

      {/* Reviews */}
      {settings.features.reviews && (
      <section id="reviews" className="scroll-mt-24 mt-16">
        <Reveal>
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-display text-2xl font-semibold">Reviews</h2>
          {reviews.length > 0 && (
            <span className="flex items-center gap-2 text-sm text-muted">
              <Stars value={avgRating} /> {avgRating.toFixed(1)} · {reviews.length} review
              {reviews.length === 1 ? "" : "s"}
            </span>
          )}
        </div>

        <div className="mt-4 grid gap-6 lg:grid-cols-2">
          <div>
            {reviewCtx.canReview ? (
              <ReviewForm
                slug={slug}
                productId={product.id}
                initialRating={reviewCtx.existing?.rating ?? 0}
                initialBody={reviewCtx.existing?.body ?? ""}
              />
            ) : reviewCtx.signedIn ? (
              <p className="rounded-2xl bg-marble/40 p-4 text-sm text-muted">
                Only verified buyers can review this item.
              </p>
            ) : (
              <p className="rounded-2xl bg-marble/40 p-4 text-sm text-muted">
                <Link href="/account/sign-in" className="font-semibold text-rose-ink hover:text-rose">
                  Sign in
                </Link>{" "}
                and order this treat to leave a review.
              </p>
            )}
          </div>

          <div>
            {reviews.length === 0 ? (
              <p className="text-sm text-muted">No reviews yet. Be the first!</p>
            ) : (
              <ul className="flex flex-col gap-4">
                {reviews.map((review, index) => (
                  <li key={index} className="border-b border-line pb-4 last:border-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold">{review.authorName ?? "Customer"}</span>
                      <span className="text-xs text-muted">
                        {formatLongDate(review.createdAt.slice(0, 10))}
                      </span>
                    </div>
                    <Stars value={review.rating} className="mt-1 text-sm" />
                    {review.body && <p className="mt-1 text-sm text-muted">{review.body}</p>}
                    {settings.features.photoReviews && review.imageUrls.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {review.imageUrls.map((url, i) => (
                          <div key={i} className="relative h-16 w-16 overflow-hidden rounded-lg">
                            <Image
                              src={url}
                              alt={`Review photo ${i + 1}`}
                              fill
                              sizes="64px"
                              className="object-cover"
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        </Reveal>
      </section>
      )}

      {/* You might also like */}
      {related.length > 0 && (
        <section className="mt-20">
          <Reveal>
            <h2 className="font-display text-2xl font-semibold">You might also like</h2>
            <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {related.map((item) => (
                <ProductCard key={item.id} product={item} />
              ))}
            </div>
          </Reveal>
        </section>
      )}
    </main>
  );
}
