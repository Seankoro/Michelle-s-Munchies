"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/cn";

type RevealProps = {
  children: ReactNode;
  /** Stagger delay in ms before the fade-up runs once in view. */
  delay?: number;
  className?: string;
};

/**
 * Scroll-reveal wrapper. Children render normally on the server and for no-JS
 * visitors. Only after mount does this add the hidden pre-state and observe the
 * element, fading it up the first time it scrolls into view. Honors
 * prefers-reduced-motion by rendering plainly, with no hidden state and no observer.
 */
export function Reveal({ children, delay = 0, className }: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  // Becomes true on mount when motion is allowed, then applies the `.reveal` pre-state.
  const [armed, setArmed] = useState(false);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const prefersReduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (prefersReduced || typeof IntersectionObserver === "undefined") {
      return; // leave content visible, no animation
    }

    setArmed(true);
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShown(true);
          observer.disconnect();
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -10% 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const style = delay ? ({ "--reveal-delay": `${delay}ms` } as CSSProperties) : undefined;

  return (
    <div
      ref={ref}
      style={style}
      className={cn(armed && "reveal", shown && "is-in", className)}
    >
      {children}
    </div>
  );
}
