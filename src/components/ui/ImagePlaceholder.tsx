import { cn } from "@/lib/cn";

type Aspect = "square" | "portrait" | "video" | "wide";

const aspectClasses: Record<Aspect, string> = {
  square: "aspect-square",
  portrait: "aspect-[4/5]",
  video: "aspect-video",
  wide: "aspect-[3/1]",
};

/**
 * A clearly-labelled placeholder marking exactly where a real photo will go.
 * We have no product images yet, so every image slot uses one of these — the
 * dashed blush border + label makes the "add a photo here" intent obvious.
 */
export function ImagePlaceholder({
  label = "Photo coming soon",
  aspect = "square",
  icon = "🍰",
  className,
}: {
  label?: string;
  aspect?: Aspect;
  icon?: string;
  className?: string;
}) {
  return (
    <div
      role="img"
      aria-label={`Placeholder: ${label}`}
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-blush bg-blush-soft/60 text-center text-rose-deep",
        aspectClasses[aspect],
        className,
      )}
    >
      <span className="text-3xl" aria-hidden="true">
        {icon}
      </span>
      <span className="px-3 text-[0.7rem] font-semibold uppercase tracking-wide">
        {label}
      </span>
    </div>
  );
}
