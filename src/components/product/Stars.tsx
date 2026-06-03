import { cn } from "@/lib/cn";

/** Read-only star rating display. */
export function Stars({ value, className }: { value: number; className?: string }) {
  const rounded = Math.round(value);
  return (
    <span
      className={cn("inline-flex items-center", className)}
      role="img"
      aria-label={`${value.toFixed(1)} out of 5 stars`}
    >
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} aria-hidden="true" className={i <= rounded ? "text-rose-deep" : "text-line"}>
          ★
        </span>
      ))}
    </span>
  );
}
