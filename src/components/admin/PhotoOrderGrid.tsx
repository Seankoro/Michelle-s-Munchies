"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import Image from "next/image";
import { cn } from "@/lib/cn";

/** How long a finger rests on a photo before it lifts, so a swipe across the photos still scrolls the form. */
const HOLD_MS = 350;
/** How far a finger may drift during that hold before it counts as a scroll instead. */
const HOLD_SLOP_PX = 8;
/** While dragging, this close to either end of the row starts it scrolling that way. */
const EDGE_PX = 48;
/** Fastest the row scrolls on its own, in pixels per frame, with the pointer at or past the end. */
const MAX_SCROLL_STEP = 14;

/**
 * The product editor's photos, in product page order. Drag a photo to move it:
 * straight away with a mouse, or after a short press and hold on a touch screen,
 * since dragging on touch would otherwise fight scrolling the form. With
 * keyboard focus on a photo, the left and right arrow keys move it instead.
 *
 * The photos sit in one row that scrolls sideways, so the section stays the
 * same short height however many there are; a column of rows was awkward to
 * work through on a phone. Dragging a photo near either end of the row scrolls
 * it, so a photo can still be carried to the far end. The add tile comes first,
 * where it is always in view.
 */
export function PhotoOrderGrid({
  urls,
  cardUrl,
  onReorder,
  onRemove,
  onPickCard,
  addTile,
}: {
  urls: string[];
  /** The photo shown on menu cards. */
  cardUrl: string | undefined;
  onReorder: (urls: string[]) => void;
  onRemove: (url: string) => void;
  onPickCard: (url: string) => void;
  /** The upload tile, kept after the last photo. */
  addTile: ReactNode;
}) {
  const gridRef = useRef<HTMLUListElement>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  // Window listeners outlive a render, so they read the latest values here.
  const draggingRef = useRef<string | null>(null);
  const urlsRef = useRef(urls);
  urlsRef.current = urls;
  const onReorderRef = useRef(onReorder);
  onReorderRef.current = onReorder;
  const hold = useRef<{ x: number; y: number; timer: number } | null>(null);
  const pointer = useRef({ x: 0, y: 0 });
  // Set by the effect below, which owns the frame loop.
  const startAutoScroll = useRef<() => void>(() => {});

  function cancelHold() {
    if (hold.current) window.clearTimeout(hold.current.timer);
    hold.current = null;
  }

  function lift(url: string) {
    cancelHold();
    draggingRef.current = url;
    setDragging(url);
    navigator.vibrate?.(15);
    startAutoScroll.current();
  }

  useEffect(() => {
    let frame = 0;

    // Whichever photo is under the pointer is where the dragged one goes. Only
    // across, so a finger drifting above or below the row still counts.
    function reorderUnder(x: number) {
      const url = draggingRef.current;
      const grid = gridRef.current;
      if (!url || !grid) return;
      const tiles = Array.from(grid.querySelectorAll<HTMLElement>("[data-photo]"));
      const over = tiles.find((tile) => {
        const box = tile.getBoundingClientRect();
        return x >= box.left && x <= box.right;
      });
      const target = over?.dataset.photo;
      if (!target || target === url) return;
      const next = urlsRef.current.filter((u) => u !== url);
      next.splice(urlsRef.current.indexOf(target), 0, url);
      onReorderRef.current(next);
    }

    // Runs every frame while a photo is held, so the row keeps scrolling while
    // the pointer rests near an end, not only while it is moving.
    function autoScroll() {
      const grid = gridRef.current;
      if (!draggingRef.current || !grid) return;
      const box = grid.getBoundingClientRect();
      const { x } = pointer.current;
      const intoLeft = box.left + EDGE_PX - x;
      const intoRight = x - (box.right - EDGE_PX);
      const step =
        intoLeft > 0
          ? -Math.min(1, intoLeft / EDGE_PX) * MAX_SCROLL_STEP
          : intoRight > 0
            ? Math.min(1, intoRight / EDGE_PX) * MAX_SCROLL_STEP
            : 0;
      if (step) {
        grid.scrollLeft += step;
        reorderUnder(x);
      }
      frame = requestAnimationFrame(autoScroll);
    }
    startAutoScroll.current = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(autoScroll);
    };

    function onMove(event: globalThis.PointerEvent) {
      pointer.current = { x: event.clientX, y: event.clientY };
      if (hold.current) {
        const moved = Math.hypot(event.clientX - hold.current.x, event.clientY - hold.current.y);
        if (moved > HOLD_SLOP_PX) cancelHold();
        return;
      }
      reorderUnder(event.clientX);
    }

    function onEnd() {
      cancelHold();
      cancelAnimationFrame(frame);
      const url = draggingRef.current;
      if (!url) return;
      draggingRef.current = null;
      setDragging(null);
      const position = urlsRef.current.indexOf(url) + 1;
      setAnnouncement(`Photo moved to position ${position} of ${urlsRef.current.length}.`);
    }

    // Once a photo is lifted the finger drags it, not the form. This has to be
    // a non-passive touch listener, since pointer events cannot stop a scroll.
    function onTouchMove(event: TouchEvent) {
      if (draggingRef.current) event.preventDefault();
    }

    const grid = gridRef.current;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
    grid?.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => {
      cancelHold();
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
      grid?.removeEventListener("touchmove", onTouchMove);
    };
  }, []);

  function onPointerDown(event: PointerEvent<HTMLLIElement>, url: string) {
    if (event.button !== 0 || urls.length < 2) return;
    // The remove and menu card buttons keep their own taps.
    if ((event.target as HTMLElement).closest("button")) return;
    pointer.current = { x: event.clientX, y: event.clientY };
    if (event.pointerType === "mouse") {
      event.preventDefault(); // no text selection or native image drag
      lift(url);
      return;
    }
    cancelHold();
    hold.current = {
      x: event.clientX,
      y: event.clientY,
      timer: window.setTimeout(() => lift(url), HOLD_MS),
    };
  }

  function onKeyDown(event: KeyboardEvent<HTMLLIElement>, index: number) {
    const delta = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
    const target = index + delta;
    if (!delta || target < 0 || target >= urls.length) return;
    event.preventDefault();
    const next = [...urls];
    [next[index], next[target]] = [next[target], next[index]];
    onReorder(next);
    setAnnouncement(`Photo moved to position ${target + 1} of ${urls.length}.`);
  }

  return (
    <>
      <ul
        ref={gridRef}
        className="mt-2 flex items-start gap-3 overflow-x-auto overscroll-x-contain pb-2 pt-1"
      >
        <li className="shrink-0">{addTile}</li>
        {urls.map((url, index) => {
          const isCard = cardUrl === url;
          const isDragging = dragging === url;
          return (
            <li
              key={url}
              data-photo={url}
              tabIndex={urls.length > 1 ? 0 : undefined}
              aria-label={`Photo ${index + 1} of ${urls.length}${urls.length > 1 ? ". Arrow keys move it." : ""}`}
              onPointerDown={(event) => onPointerDown(event, url)}
              onKeyDown={(event) => onKeyDown(event, index)}
              onContextMenu={(event) => event.preventDefault()}
              className={cn(
                "relative w-24 shrink-0 select-none rounded-xl transition [-webkit-touch-callout:none] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose focus-visible:ring-offset-2",
                urls.length > 1 && "cursor-grab",
                isDragging && "z-10 scale-105 cursor-grabbing opacity-90",
              )}
            >
              <div
                className={cn(
                  "relative h-24 w-24 overflow-hidden rounded-xl border",
                  isCard ? "border-rose ring-2 ring-rose" : "border-line",
                  isDragging && "shadow-soft",
                )}
              >
                <Image
                  src={url}
                  alt=""
                  fill
                  sizes="96px"
                  className="pointer-events-none object-cover"
                  draggable={false}
                />
              </div>
              {/* Inset from the corners, which the rounded photo would clip. */}
              <span
                aria-hidden="true"
                className="absolute left-1.5 top-1.5 flex h-6 min-w-6 items-center justify-center rounded-full bg-ink/70 px-1.5 text-xs font-semibold text-white"
              >
                {index + 1}
              </span>
              <button
                type="button"
                aria-label={`Remove photo ${index + 1}`}
                onClick={() => onRemove(url)}
                className="absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded-full bg-ink/70 text-sm font-semibold text-white transition hover:bg-ink active:scale-90"
              >
                ✕
              </button>
              <button
                type="button"
                aria-pressed={isCard}
                aria-label={isCard ? `Photo ${index + 1} is the menu card photo` : `Use photo ${index + 1} on the menu card`}
                onClick={() => onPickCard(url)}
                className={cn(
                  "mt-1.5 h-9 w-full rounded-full text-xs font-semibold transition active:scale-95",
                  isCard
                    ? "bg-rose text-white"
                    : "border border-line bg-white text-ink hover:border-rose",
                )}
              >
                {isCard ? "Menu card" : "Use on card"}
              </button>
            </li>
          );
        })}
      </ul>
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
    </>
  );
}
