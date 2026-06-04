import Link from "next/link";
import { buttonClasses } from "@/components/ui/Button";
import { RibbonBow } from "@/components/ui/RibbonBow";
import { RibbonDivider } from "@/components/ui/RibbonDivider";
import { RecommendationRail } from "@/components/product/RecommendationRail";
import { Reveal } from "@/components/ui/Reveal";
import { fetchFeatured } from "@/lib/products";
import { fetchStoreSettings } from "@/lib/settings";
import { InstagramGrid } from "@/components/content/InstagramGrid";

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
    body: "Michelle bakes to order. You'll get email updates right up to ready-for-collection.",
    icon: "🍪",
  },
];

export default async function HomePage() {
  // Best sellers first, then Michelle's picks, set in admin.
  const featured = await fetchFeatured(8);
  const { features } = await fetchStoreSettings();

  return (
    <main>
      {/* Hero */}
      <section className="marble-surface marble-animated">
        <div className="mx-auto flex max-w-none flex-col items-center px-6 py-20 text-center sm:py-28 lg:px-10">
          <RibbonBow className="mb-5 h-12 w-16 animate-float" />
          <p className="mb-4 text-sm font-semibold uppercase tracking-[0.2em] text-rose">
            Home-based bakery · Singapore
          </p>
          <h1 className="font-display text-5xl font-semibold sm:text-6xl">
            Michelle&rsquo;s Munchies
          </h1>
          <p className="mt-5 flex max-w-xl flex-wrap items-center justify-center gap-1.5 text-lg text-muted">
            Freshly baked treats, made to order and finished with a
            <span role="img" aria-label="ribbon" className="inline-flex">
              <RibbonBow withTails={false} className="h-5 w-7" />
            </span>
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
            <Link href="/menu" className={buttonClasses({ size: "lg" })}>
              Browse the menu
            </Link>
            <Link href="/about" className={buttonClasses({ variant: "secondary", size: "lg" })}>
              Our story
            </Link>
          </div>
        </div>
      </section>

      {/* Best-sellers & recommendations */}
      <section className="mx-auto max-w-none px-6 py-16 lg:px-10">
        <Reveal>
          <div className="text-center">
            <h2 className="font-display text-3xl font-semibold sm:text-4xl">
              Loved by our regulars
            </h2>
            <p className="mt-3 text-muted">Our best-sellers and a few of Michelle&rsquo;s picks.</p>
            <p className="mt-1 text-sm text-rose lg:hidden">Swipe to see more →</p>
          </div>
          <RibbonDivider className="my-8" />

          <RecommendationRail products={featured} />

          <div className="mt-10 text-center">
            <Link href="/menu" className={buttonClasses({ variant: "secondary" })}>
              See the full menu
            </Link>
          </div>
        </Reveal>
      </section>

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

      {/* Instagram grid (manual curation) */}
      {features.instagram && (
        <Reveal>
          <InstagramGrid />
        </Reveal>
      )}
    </main>
  );
}
