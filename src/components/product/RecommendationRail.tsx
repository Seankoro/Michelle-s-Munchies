"use client";

import { useEffect, useRef, useState } from "react";
import type { Product } from "@/lib/types";
import { ProductCard } from "@/components/product/ProductCard";
import { cn } from "@/lib/cn";

/**
 * Recommendations carousel. On phone/tablet it is a native scroll-snap rail you
 * swipe through, with the next card peeking at the edge and dot indicators
 * tracking your place. On lg+ the same products render as a static grid, so
 * desktop is not a mobile afterthought. No autoplay (attention/accessibility).
 */
export function RecommendationRail({ products }: { products: Product[] }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [nudge, setNudge] = useState(false);

  // One-shot swipe hint on small screens, unless the user prefers reduced motion.
  useEffect(() => {
    const prefersReduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (prefersReduced || window.innerWidth >= 1024) return;
    const on = window.setTimeout(() => setNudge(true), 650);
    const off = window.setTimeout(() => setNudge(false), 1700);
    return () => {
      window.clearTimeout(on);
      window.clearTimeout(off);
    };
  }, []);

  // Track the card nearest the viewport centre as the rail scrolls. A native
  // listener (rather than React's onScroll prop) is used because scroll doesn't
  // bubble and the delegated handler can miss programmatic/inertial scrolls.
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const center = track.scrollLeft + track.clientWidth / 2;
        let nearest = 0;
        let min = Infinity;
        Array.from(track.children).forEach((child, i) => {
          const el = child as HTMLElement;
          const elCenter = el.offsetLeft + el.clientWidth / 2;
          const distance = Math.abs(elCenter - center);
          if (distance < min) {
            min = distance;
            nearest = i;
          }
        });
        setActive(nearest);
      });
    };
    track.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      track.removeEventListener("scroll", onScroll);
    };
  }, []);

  function goTo(index: number) {
    const track = trackRef.current;
    const el = track?.children[index] as HTMLElement | undefined;
    if (track && el) track.scrollTo({ left: el.offsetLeft, behavior: "smooth" });
  }

  return (
    <div role="region" aria-label="Recommended treats" aria-roledescription="carousel">
      <div
        ref={trackRef}
        className={cn(
          "relative -mx-6 flex gap-4 overflow-x-auto scroll-pl-6 px-6 pb-2 snap-x snap-mandatory no-scrollbar",
          "lg:mx-0 lg:grid lg:grid-cols-4 lg:gap-6 lg:overflow-visible lg:px-0 lg:pb-0 lg:snap-none",
          nudge && "animate-nudge",
        )}
      >
        {products.map((product) => (
          <div
            key={product.id}
            className="shrink-0 basis-[78%] snap-start sm:basis-[46%] lg:basis-auto"
          >
            <ProductCard product={product} />
          </div>
        ))}
      </div>

      {products.length > 1 && (
        <div className="mt-5 flex justify-center gap-2 lg:hidden">
          {products.map((product, index) => (
            <button
              key={product.id}
              type="button"
              onClick={() => goTo(index)}
              aria-label={`Go to recommendation ${index + 1}`}
              aria-current={active === index}
              className={cn(
                "h-2 rounded-full transition-all",
                active === index ? "w-6 bg-rose-deep" : "w-2 bg-line hover:bg-rose",
              )}
            />
          ))}
        </div>
      )}
    </div>
  );
}
