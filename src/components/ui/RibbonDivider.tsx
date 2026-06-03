import { cn } from "@/lib/cn";
import { RibbonBow } from "./RibbonBow";

/** A bow-tied section divider: a hairline with the signature bow in the middle. */
export function RibbonDivider({ className }: { className?: string }) {
  return (
    <div
      className={cn("flex items-center justify-center gap-4 py-2", className)}
      aria-hidden="true"
    >
      <span className="h-px w-16 bg-line sm:w-28" />
      <RibbonBow withTails={false} className="h-8 w-10" />
      <span className="h-px w-16 bg-line sm:w-28" />
    </div>
  );
}
