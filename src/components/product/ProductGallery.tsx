"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import Image from "next/image";
import { cn } from "@/lib/cn";

/**
 * The product page photos: one box, with the photos swapping inside it and a
 * "2 / 3" counter in its top-right corner. No thumbnail strip, so the photo
 * gets the whole space. Each device gets the controls that suit it:
 *
 * - Phone (below md): the box runs edge to edge, swipe to change, dots below.
 *   No arrows, which would sit on top of a small photo.
 * - Tablet (md to lg): swipe, or the arrows, which stay visible since a touch
 *   screen has no hover. Dots too.
 * - Computer (lg and up, with a mouse): arrows fade in on hover or keyboard
 *   focus, a click on either half of the photo steps that way, and the arrow
 *   keys work once the box has focus. A trackpad swipe still scrolls it. A
 *   large touch tablet is just as wide but cannot hover, so it keeps the arrows.
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
  const several = count > 1;

  // Follow the scroll position so swipes, arrows and clicks all agree on
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

  // Computer only: a click on the left or right half of the photo steps that
  // way. On touch a tap would fight the swipe, so it is left alone there.
  function onPhotoClick(event: MouseEvent<HTMLDivElement>) {
    if (!several || !window.matchMedia("(min-width: 1024px) and (hover: hover)").matches) return;
    const box = event.currentTarget.getBoundingClientRect();
    go(active + (event.clientX - box.left < box.width / 2 ? -1 : 1));
  }

  const arrowClass =
    "absolute top-1/2 z-10 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-line bg-white/95 text-xl font-bold text-ink shadow-soft transition hover:border-rose active:scale-95 md:flex lg:[@media(hover:hover)]:opacity-0 lg:group-hover:opacity-100 lg:focus-visible:opacity-100";

  return (
    // Bleeds past the page gutter on a phone so the photo runs edge to edge.
    <div className="group relative -mx-6 md:mx-0">
      <div
        ref={trackRef}
        role="region"
        aria-roledescription="carousel"
        aria-label={`${name} photos`}
        tabIndex={several ? 0 : undefined}
        onKeyDown={several ? onKeyDown : undefined}
        onClick={onPhotoClick}
        className={cn(
          "flex aspect-square w-full snap-x snap-mandatory overflow-x-auto overflow-y-hidden no-scrollbar focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose focus-visible:ring-offset-2 md:rounded-2xl",
          several && "lg:cursor-pointer",
        )}
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

      {several && (
        <>
          <span
            aria-hidden="true"
            className="absolute right-3 top-3 rounded-full bg-white/90 px-2.5 py-0.5 text-xs font-semibold text-rose-ink shadow-soft"
          >
            {active + 1} / {count}
          </span>
          {/* Hidden rather than disabled at the ends, so they cannot reappear
              on hover over nothing to go to. */}
          <button
            type="button"
            aria-label="Previous photo"
            onClick={() => go(active - 1)}
            disabled={active <= 0}
            className={cn(arrowClass, "left-3", active <= 0 && "invisible")}
          >
            ‹
          </button>
          <button
            type="button"
            aria-label="Next photo"
            onClick={() => go(active + 1)}
            disabled={active >= count - 1}
            className={cn(arrowClass, "right-3", active >= count - 1 && "invisible")}
          >
            ›
          </button>
          <div aria-hidden="true" className="absolute inset-x-0 bottom-3 flex justify-center gap-1.5 lg:hidden">
            {urls.map((url, index) => (
              <span
                key={url}
                className={cn(
                  "h-2 w-2 rounded-full border border-rose transition",
                  index === active ? "bg-rose" : "bg-white/80",
                )}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
