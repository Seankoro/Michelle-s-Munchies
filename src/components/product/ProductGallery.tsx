"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import Image from "next/image";
import { cn } from "@/lib/cn";

/**
 * The product page photos: one large viewer that swipes between photos on touch,
 * with arrow buttons, a photo counter and clickable thumbnails for mouse users,
 * and the arrow keys once it has focus.
 *
 * Unlike ScrollRail, this track snaps. ScrollRail dropped snapping because its
 * grab-pan and slider write arbitrary scrollLeft values that a snap overrides.
 * Here every programmatic scroll targets a whole slide, which is exactly a snap
 * point, and snapping is what makes a half swipe settle on one photo.
 */
export function ProductGallery({ name, urls }: { name: string; urls: string[] }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const count = urls.length;

  // Follow the scroll position so swipes, arrows and thumbnails all agree on
  // which photo is showing. Native listener because scroll doesn't bubble.
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (track.clientWidth > 0) setActive(Math.round(track.scrollLeft / track.clientWidth));
      });
    };
    track.addEventListener("scroll", update, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      track.removeEventListener("scroll", update);
    };
  }, []);

  function go(index: number) {
    const track = trackRef.current;
    if (!track) return;
    const target = Math.max(0, Math.min(count - 1, index));
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    track.scrollTo({ left: target * track.clientWidth, behavior: reduceMotion ? "auto" : "smooth" });
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      go(active + 1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      go(active - 1);
    }
  }

  const arrowClass =
    "absolute top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-line bg-white/95 text-xl font-bold text-ink shadow-soft transition hover:border-rose active:scale-95 disabled:pointer-events-none disabled:opacity-0";

  return (
    <div>
      <div className="relative">
        <div
          ref={trackRef}
          role="region"
          aria-roledescription="carousel"
          aria-label={`${name} photos`}
          tabIndex={count > 1 ? 0 : undefined}
          onKeyDown={count > 1 ? onKeyDown : undefined}
          className="flex aspect-square w-full snap-x snap-mandatory overflow-x-auto overflow-y-hidden rounded-2xl no-scrollbar focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose focus-visible:ring-offset-2"
        >
          {urls.map((url, index) => (
            <div
              key={url}
              role="group"
              aria-roledescription="slide"
              aria-label={`Photo ${index + 1} of ${count}`}
              className="relative aspect-square w-full shrink-0 snap-center"
            >
              <Image
                src={url}
                alt={index === 0 ? name : `${name} photo ${index + 1}`}
                fill
                sizes="(max-width: 1024px) 100vw, 50vw"
                className="object-cover"
                draggable={false}
                priority={index === 0}
              />
            </div>
          ))}
        </div>

        {count > 1 && (
          <>
            <button
              type="button"
              aria-label="Previous photo"
              onClick={() => go(active - 1)}
              disabled={active <= 0}
              className={cn(arrowClass, "left-3")}
            >
              ‹
            </button>
            <button
              type="button"
              aria-label="Next photo"
              onClick={() => go(active + 1)}
              disabled={active >= count - 1}
              className={cn(arrowClass, "right-3")}
            >
              ›
            </button>
            <span
              aria-hidden="true"
              className="absolute bottom-3 right-3 rounded-full bg-white/90 px-2.5 py-0.5 text-xs font-semibold text-ink shadow-soft"
            >
              {active + 1} / {count}
            </span>
          </>
        )}
      </div>

      {count > 1 && (
        <div className="mt-3 grid grid-cols-4 gap-3">
          {urls.map((url, index) => (
            <button
              key={url}
              type="button"
              onClick={() => go(index)}
              aria-label={`Show photo ${index + 1} of ${count}`}
              aria-current={index === active ? "true" : undefined}
              className={cn(
                "relative aspect-square overflow-hidden rounded-xl border-2 transition active:scale-95",
                index === active ? "border-rose" : "border-transparent opacity-70 hover:opacity-100",
              )}
            >
              <Image src={url} alt="" fill sizes="(max-width: 1024px) 25vw, 12vw" className="object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
