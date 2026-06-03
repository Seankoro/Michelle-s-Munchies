import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type BadgeTone =
  | "bestseller"
  | "recommended"
  | "soldout"
  | "dietary"
  | "neutral";

const toneClasses: Record<BadgeTone, string> = {
  bestseller: "bg-rose-deep text-white",
  recommended: "bg-sky-deep text-white",
  soldout: "bg-ink/80 text-white",
  dietary: "border border-blush bg-blush-soft text-rose-deep",
  neutral: "bg-marble text-muted",
};

export function Badge({
  tone = "neutral",
  className,
  children,
}: {
  tone?: BadgeTone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold",
        toneClasses[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
