"use client";

import Image from "next/image";
import { useState } from "react";
import { cn } from "@/lib/cn";

const MASCOT_ALT = "Michelle's Munchies mascot, a hand-drawn girl with a bow in her hair";

/**
 * The hand-drawn mascot with a speech bubble, the site's voice. Give it one
 * line for a static moment, or several and a tap cycles through them. The
 * bubble is real text (never aria-hidden) and the slight tilt keeps it in the
 * mascot's sketchy art style.
 */
export function MascotSays({
  lines,
  size = "quiet",
  priority = false,
  className,
}: {
  lines: string[];
  size?: "hero" | "quiet";
  /** Preload the mascot image, for above-the-fold spots like the home hero. */
  priority?: boolean;
  className?: string;
}) {
  const [index, setIndex] = useState(0);
  const line = lines.length > 0 ? lines[index % lines.length] : null;
  const cycles = lines.length > 1;

  const content = (
    <>
      {line && (
        <span
          key={index}
          className={cn(
            "relative block max-w-xs -rotate-1 animate-[pop_0.3s_ease-out] rounded-2xl border-2 border-ink/70 bg-white px-4 py-2.5 font-semibold text-ink",
            size === "hero" ? "text-base" : "text-sm",
          )}
        >
          {line}
          <span
            aria-hidden="true"
            className="absolute -bottom-[9px] left-1/2 h-3.5 w-3.5 -translate-x-1/2 rotate-45 border-b-2 border-r-2 border-ink/70 bg-white"
          />
        </span>
      )}
      <Image
        src="/logo.png"
        // In the cycling variant the whole figure is a button named by the
        // bubble text, so a descriptive alt would bloat and re-announce the
        // button's accessible name on every tap.
        alt={cycles ? "" : MASCOT_ALT}
        // The real display size, so next/image emits a srcset around it
        // instead of shipping the full 512 upload into a 96 pixel box. On the
        // hero this one is preloaded, so the saving lands on first paint.
        width={size === "hero" ? 96 : 64}
        height={size === "hero" ? 96 : 64}
        priority={priority}
        className={cn(size === "hero" ? "h-24 w-24 animate-float" : "h-16 w-16")}
      />
    </>
  );

  const layout = cn("flex flex-col items-center gap-3", className);

  if (!cycles) {
    return <div className={layout}>{content}</div>;
  }
  return (
    <button
      type="button"
      onClick={() => setIndex((i) => i + 1)}
      aria-live="polite"
      className={cn(layout, "cursor-pointer transition active:scale-[0.98]")}
    >
      {content}
      {/* The bubble text itself names the button; this only adds the affordance. */}
      <span className="sr-only">Tap for another note from Michelle.</span>
    </button>
  );
}
