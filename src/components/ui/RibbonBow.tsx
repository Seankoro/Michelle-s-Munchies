import { cn } from "@/lib/cn";

type RibbonBowProps = {
  className?: string;
  /** Show the dangling swallowtail ribbons beneath the bow. */
  withTails?: boolean;
};

/**
 * The Michelle's Munchies signature, a little satin bow drawn as inline SVG.
 * No image asset, scales crisply, and themable. Used as the brand mark accent,
 * the ribbon-pull menu handle, and section dividers.
 */
export function RibbonBow({ className, withTails = true }: RibbonBowProps) {
  return (
    <svg
      viewBox="0 0 72 62"
      className={cn("block", className)}
      aria-hidden="true"
      focusable="false"
    >
      {withTails && (
        <g>
          {/* left tail, the swallowtail notch at the bottom */}
          <path
            d="M34 35 L27 59 L31.5 53 L34 59 L37 36 Z"
            fill="var(--color-rose)"
          />
          {/* right tail */}
          <path
            d="M38 35 L45 59 L40.5 53 L38 59 L35 36 Z"
            fill="var(--color-rose)"
          />
        </g>
      )}

      {/* left loop */}
      <path
        d="M34 23 L9 14 C3 12 3 38 9 36 L34 32 Z"
        fill="var(--color-blush)"
        stroke="var(--color-rose)"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      {/* right loop */}
      <path
        d="M38 23 L63 14 C69 12 69 38 63 36 L38 32 Z"
        fill="var(--color-blush)"
        stroke="var(--color-rose)"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      {/* centre knot */}
      <rect x="31" y="20" width="10" height="15" rx="4.5" fill="var(--color-rose-deep)" />
    </svg>
  );
}
