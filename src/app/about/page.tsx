import type { Metadata } from "next";
import Link from "next/link";
import { ImagePlaceholder } from "@/components/ui/ImagePlaceholder";
import { RibbonDivider } from "@/components/ui/RibbonDivider";
import { buttonClasses } from "@/components/ui/Button";
import { Reveal } from "@/components/ui/Reveal";

export const metadata: Metadata = {
  title: "Our Story",
  description: "The story behind Michelle's Munchies, a home-based bakery in Singapore.",
};

export default function AboutPage() {
  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <Reveal>
        <header className="text-center">
          <p className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-rose">
            Our Story
          </p>
          <h1 className="font-display text-4xl font-semibold sm:text-5xl">
            Baked at home, in small batches
          </h1>
        </header>
      </Reveal>

      <RibbonDivider className="my-10" />

      <div className="grid items-center gap-10 md:grid-cols-2">
        <Reveal>
          <ImagePlaceholder aspect="square" label="Photo of Michelle / the bakes" icon="👩‍🍳" />
        </Reveal>
        <Reveal delay={120}>
          <div className="space-y-4 text-muted">
            {/* Placeholder copy. Replace with Michelle's real story. */}
            <p>
              Michelle&rsquo;s Munchies began in a small home kitchen in Singapore. The idea was
              simple. Something freshly baked, made with care, can make any day a little sweeter.
            </p>
            <p>
              Every order is baked fresh in small batches, never mass-produced and never sitting
              on a shelf. Just good ingredients, a careful hand, and a ribbon on top.
            </p>
            <p className="rounded-xl bg-blush-soft/60 px-4 py-3 text-sm text-rose-deep">
              🏠 We&rsquo;re a home-based business operating under Singapore&rsquo;s Home-Based
              Small Scale Business scheme.
            </p>
          </div>
        </Reveal>
      </div>

      <Reveal>
        <div className="mt-12 text-center">
          <Link href="/menu" className={buttonClasses({ size: "lg" })}>
            See what&rsquo;s baking
          </Link>
        </div>
      </Reveal>
    </main>
  );
}
