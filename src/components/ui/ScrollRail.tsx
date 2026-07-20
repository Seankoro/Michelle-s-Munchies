"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * A horizontal product rail every input method can browse: finger-swipe on
 * touch, arrow buttons and a draggable slider for mouse and trackpad. One
 * layout for all devices; at xl the caller's track classes switch to a grid
 * and the controls hide themselves.
 */
export function ScrollRail({
  label,
  trackClassName,
  children,
}: {
  /** Accessible name for the rail and its controls, e.g. the category name. */
  label: string;
  /** Full class set for the scroll track, including the xl grid switch. */
  trackClassName: string;
  children: ReactNode;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(0);
  const [max, setMax] = useState(0);

  // Native listener because scroll doesn't bubble; ResizeObserver keeps the
  // slider range correct across viewport changes and the xl grid switch.
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        setPos(track.scrollLeft);
        setMax(Math.max(0, track.scrollWidth - track.clientWidth));
      });
    };
    update();
    track.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(track);
    return () => {
      cancelAnimationFrame(frame);
      track.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, []);

  const scrollable = max > 8;

  function page(direction: 1 | -1) {
    const track = trackRef.current;
    if (!track) return;
    track.scrollBy({ left: direction * track.clientWidth * 0.8, behavior: "smooth" });
  }

  // Mouse grab-to-pan. A small movement threshold keeps plain clicks working
  // on the cards, and the click that trails a real drag is swallowed so a pan
  // never accidentally opens a product. Ctrl+drag is left alone for text
  // selection, and touch keeps its native swipe.
  const grab = useRef<{ startX: number; startScroll: number; pointerId: number; active: boolean } | null>(null);
  const swallowClick = useRef(false);

  function onPointerDown(event: React.PointerEvent) {
    if (event.pointerType !== "mouse" || event.button !== 0 || event.ctrlKey) return;
    const track = trackRef.current;
    if (!track) return;
    grab.current = {
      startX: event.clientX,
      startScroll: track.scrollLeft,
      pointerId: event.pointerId,
      active: false,
    };
  }

  function onPointerMove(event: React.PointerEvent) {
    const state = grab.current;
    const track = trackRef.current;
    if (!state || !track) return;
    const dx = event.clientX - state.startX;
    if (!state.active) {
      if (Math.abs(dx) < 6) return;
      state.active = true;
      try {
        track.setPointerCapture(state.pointerId);
      } catch {
        // Capture can fail if the pointer is already gone; panning still works.
      }
      track.style.userSelect = "none";
      track.style.cursor = "grabbing";
    }
    track.scrollLeft = state.startScroll - dx;
  }

  function onPointerEnd() {
    const state = grab.current;
    const track = trackRef.current;
    grab.current = null;
    if (!state?.active || !track) return;
    track.style.userSelect = "";
    track.style.cursor = "";
    // Swallow only the click that immediately trails this drag. The latch
    // expires so an interrupted drag can never eat a later, honest click.
    swallowClick.current = true;
    window.setTimeout(() => {
      swallowClick.current = false;
    }, 150);
  }

  function onClickCapture(event: React.MouseEvent) {
    if (swallowClick.current) {
      swallowClick.current = false;
      event.preventDefault();
      event.stopPropagation();
    }
  }

  const arrowClass =
    "absolute top-[40%] z-10 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-line bg-white/95 text-lg font-bold text-ink shadow-soft transition hover:border-rose active:scale-95 disabled:pointer-events-none disabled:opacity-0 xl:hidden";

  return (
    <div role="region" aria-label={label} className="relative">
      <div
        ref={trackRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onClickCapture={onClickCapture}
        onDragStart={(event) => event.preventDefault()}
        className={cn(trackClassName, "cursor-grab xl:cursor-auto")}
      >
        {children}
      </div>

      {scrollable && (
        <>
          <button
            type="button"
            aria-label={`Scroll ${label} back`}
            onClick={() => page(-1)}
            disabled={pos <= 8}
            className={cn(arrowClass, "left-0")}
          >
            ‹
          </button>
          <button
            type="button"
            aria-label={`Scroll ${label} forward`}
            onClick={() => page(1)}
            disabled={pos >= max - 8}
            className={cn(arrowClass, "right-0")}
          >
            ›
          </button>
          <div
            style={{ "--rail-progress": `${max > 0 ? (Math.min(pos, max) / max) * 100 : 0}%` } as CSSProperties}
            className="relative mx-auto mt-4 h-5 w-48 max-w-[70%] xl:hidden"
          >
            <input
              type="range"
              min={0}
              max={Math.round(max)}
              value={Math.round(Math.min(pos, max))}
              onChange={(event) => {
                const track = trackRef.current;
                if (track) track.scrollLeft = Number(event.target.value);
              }}
              aria-label={`Scroll position for ${label}`}
              className="rail-slider absolute inset-x-0 top-1/2 w-full -translate-y-1/2 cursor-pointer"
            />
            {/* Visible bow, positioned by --rail-progress so its centre reaches
                both ends. The input above is the invisible drag handle. */}
            <span aria-hidden="true" className="rail-bow-thumb" />
          </div>
        </>
      )}
    </div>
  );
}
