import type { CSSProperties } from "react";
import Link from "next/link";
import { buttonClasses } from "@/components/ui/Button";
import { RibbonBow } from "@/components/ui/RibbonBow";
import { RibbonDivider } from "@/components/ui/RibbonDivider";
import { RecommendationRail } from "@/components/product/RecommendationRail";
import { Reveal } from "@/components/ui/Reveal";
import { MascotSays } from "@/components/ui/MascotSays";
import { fetchFeatured, toCardProduct } from "@/lib/products";
import { fetchReviewHighlights } from "@/lib/reviews";
import { fetchStoreSettings } from "@/lib/settings";
import { earliestFulfillmentDate, formatLongDate } from "@/lib/order";
import { singaporeNow } from "@/lib/time";
import { jsonLd } from "@/lib/json-ld";
import { InstagramGrid } from "@/components/content/InstagramGrid";

// Render per request. Without this the page is prerendered at build time,
// freezing the mascot's admin-written message, the "freshly baked for {date}"
// line, and the featured rail until the next deploy.
export const dynamic = "force-dynamic";

const steps = [
  {
    title: "Browse & choose",
    body: "Pick your treats from the menu and tap add. We'll ask for any options right there.",
    icon: "🧁",
  },
  {
    title: "Schedule & confirm",
    body: "Choose self-pickup or delivery and a date, then confirm on WhatsApp where we arrange PayNow.",
    icon: "🎀",
  },
  {
    title: "Freshly baked",
    body: "Michelle bakes to order. You'll get email updates right up to the moment it's ready.",
    icon: "🍪",
  },
];

export default async function HomePage() {
  // Best sellers first, then Michelle's picks, set in admin.
  const featured = await fetchFeatured(8);
  const settings = await fetchStoreSettings();
  const reviews = settings.features.reviews
    ? await fetchReviewHighlights()
    : { avg: 0, count: 0, quotes: [] };

  // The mascot's speech bubble. Michelle's own message from admin Settings
  // leads when present; a tap cycles through the rest.
  const earliest = earliestFulfillmentDate(
    settings.leadTimeDays,
    singaporeNow(),
    settings.dailyCutoffTime,
  );
  // Any owner-written lines come first, then the built-in automatic lines, which
  // always stay in the cycle. The mascot rotates through the lot on tap.
  const mascotLines = [
    ...settings.mascotMessages,
    "Hi, I'm Michelle! Everything here is baked to order, just for you.",
    `Order today and it's freshly baked for ${formatLongDate(earliest)}.`,
  ];

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const businessJsonLd = {
    "@context": "https://schema.org",
    "@type": "Bakery",
    name: "Michelle's Munchies",
    description:
      "A home-based bakery in Singapore. Freshly baked treats, made to order for self-pickup or delivery.",
    url: siteUrl,
    image: `${siteUrl}/og.png`,
    logo: `${siteUrl}/icon.png`,
    servesCuisine: "Bakery",
    priceRange: "$$",
    address: { "@type": "PostalAddress", addressLocality: "Singapore", addressCountry: "SG" },
  };

  return (
    <main>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(businessJsonLd) }} />
      {/* Hero */}
      <section className="marble-surface marble-animated">
        <div className="mx-auto flex max-w-none flex-col items-center px-6 py-20 text-center sm:py-28 lg:px-10">
          <div className="animate-rise mb-5" style={{ "--rise-delay": "0ms" } as CSSProperties}>
            <MascotSays lines={mascotLines} size="hero" priority />
          </div>
          <p
            className="animate-rise mb-4 text-sm font-semibold uppercase tracking-[0.2em] text-rose-deep"
            style={{ "--rise-delay": "90ms" } as CSSProperties}
          >
            Home-based bakery · Singapore
          </p>
          <h1
            className="animate-rise font-display text-5xl font-semibold sm:text-6xl"
            style={{ "--rise-delay": "170ms" } as CSSProperties}
          >
            Michelle&rsquo;s Munchies
          </h1>
          <p
            className="animate-rise mt-5 flex max-w-xl flex-wrap items-center justify-center gap-1.5 text-lg text-muted"
            style={{ "--rise-delay": "260ms" } as CSSProperties}
          >
            Freshly baked treats, made to order and finished with a
            <span role="img" aria-label="ribbon" className="inline-flex">
              <RibbonBow withTails={false} className="h-5 w-7" />
            </span>
          </p>
          <div
            className="animate-rise mt-10 flex flex-wrap items-center justify-center gap-4"
            style={{ "--rise-delay": "350ms" } as CSSProperties}
          >
            <Link href="/menu" className={buttonClasses({ size: "lg" })}>
              Browse the menu
            </Link>
            <Link href="/about" className={buttonClasses({ variant: "secondary", size: "lg" })}>
              Our story
            </Link>
          </div>
        </div>
      </section>

      {/* Best-sellers & recommendations. Hidden entirely when nothing is
          featured so the home page never shows an empty rail. */}
      {featured.length > 0 && (
      <section className="mx-auto max-w-none px-6 py-16 lg:px-10">
        <Reveal>
          <div className="text-center">
            <h2 className="font-display text-3xl font-semibold sm:text-4xl">Our favourites</h2>
            <p className="mt-3 text-muted">Our best-sellers and a few of Michelle&rsquo;s picks.</p>
          </div>
          <RibbonDivider className="my-8" />

          <RecommendationRail products={featured.map(toCardProduct)} />

          <div className="mt-10 text-center">
            <Link href="/menu" className={buttonClasses({ variant: "secondary" })}>
              See the full menu
            </Link>
          </div>
        </Reveal>
      </section>
      )}

      {/* Social proof, real verified-buyer reviews. Hidden until some exist. */}
      {reviews.count > 0 && (
        <section className="mx-auto max-w-none px-6 py-16 lg:px-10">
          <Reveal>
            <div className="text-center">
              <div className="text-2xl tracking-widest text-rose-deep" aria-hidden="true">
                {"★".repeat(Math.round(reviews.avg))}
                {"☆".repeat(5 - Math.round(reviews.avg))}
              </div>
              <h2 className="mt-2 font-display text-3xl font-semibold sm:text-4xl">
                Loved by our regulars
              </h2>
              <p className="mt-2 text-muted">
                {reviews.avg.toFixed(1)} from {reviews.count} verified{" "}
                {reviews.count === 1 ? "review" : "reviews"}.
              </p>
            </div>
            {reviews.quotes.length > 0 && (
              <div className="mt-10 grid gap-4 sm:grid-cols-3">
                {reviews.quotes.map((quote, index) => (
                  <figure
                    key={index}
                    className="rounded-2xl border border-line bg-white p-5 text-center shadow-soft"
                  >
                    <div
                      className="text-rose-deep"
                      aria-label={`${quote.rating} out of 5 stars`}
                    >
                      {"★".repeat(quote.rating)}
                      {"☆".repeat(5 - quote.rating)}
                    </div>
                    <blockquote className="mt-3 text-sm text-ink">
                      &ldquo;{quote.body}&rdquo;
                    </blockquote>
                    <figcaption className="mt-3 text-xs font-semibold text-muted">
                      {quote.authorName.split(" ")[0]}
                    </figcaption>
                  </figure>
                ))}
              </div>
            )}
          </Reveal>
        </section>
      )}

      {/* How it works */}
      <section className="bg-marble/40">
        <div className="mx-auto max-w-none px-6 py-16 lg:px-10">
          <Reveal>
            <h2 className="text-center font-display text-3xl font-semibold sm:text-4xl">
              How it works
            </h2>
          </Reveal>
          <div className="mt-10 grid gap-8 sm:grid-cols-3">
            {steps.map((step, index) => (
              <Reveal key={step.title} delay={index * 120}>
                <div className="text-center">
                  <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-blush-soft text-3xl shadow-soft">
                    <span aria-hidden>{step.icon}</span>
                  </div>
                  <h3 className="font-display text-xl font-semibold">{step.title}</h3>
                  <p className="mt-2 text-sm text-muted">{step.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Instagram grid, manually curated */}
      {settings.features.instagram && (
        <Reveal>
          <InstagramGrid />
        </Reveal>
      )}
    </main>
  );
}
