import type { Allergen } from "@/lib/types";
import { allergenMeta } from "@/lib/catalog";
import { cn } from "@/lib/cn";

/**
 * Allergen icons with a tap/hover popup (the look you chose).
 *
 * Accessibility safety net: each chip is a real focusable <button> whose
 * `aria-label` always says "Contains peanuts" etc., so screen-reader users get
 * the information even though sighted users see just the icon until they
 * hover/tap. The popup also appears on keyboard focus (focus-within), so it's
 * reachable without a mouse. Allergen info is health-critical, so it's never
 * *only* visual.
 */
export function AllergenChips({
  allergens,
  size = "sm",
  className,
}: {
  allergens: Allergen[];
  size?: "sm" | "md";
  className?: string;
}) {
  if (allergens.length === 0) return null;

  const chip =
    size === "md" ? "h-9 w-9 text-lg" : "h-7 w-7 text-sm";

  return (
    <ul className={cn("flex flex-wrap items-center gap-1.5", className)} aria-label="Allergens">
      {allergens.map((allergen) => {
        const meta = allergenMeta[allergen];
        return (
          <li key={allergen} className="group/chip relative">
            <button
              type="button"
              aria-label={`Contains ${meta.label.toLowerCase()}`}
              className={cn(
                "flex items-center justify-center rounded-full border border-line bg-white",
                chip,
              )}
            >
              <span aria-hidden="true">{meta.icon}</span>
            </button>
            <span
              role="tooltip"
              aria-hidden="true"
              className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1 -translate-x-1/2 whitespace-nowrap rounded-lg bg-ink px-2 py-1 text-xs font-semibold text-white opacity-0 transition-opacity group-hover/chip:opacity-100 group-focus-within/chip:opacity-100"
            >
              Contains {meta.label.toLowerCase()}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
