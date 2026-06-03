import type { DietaryTag } from "@/lib/types";
import { dietaryMeta } from "@/lib/catalog";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/cn";

export function DietaryTags({
  tags,
  className,
}: {
  tags: DietaryTag[];
  className?: string;
}) {
  if (tags.length === 0) return null;

  return (
    <ul className={cn("flex flex-wrap items-center gap-2", className)}>
      {tags.map((tag) => (
        <li key={tag}>
          <Badge tone="dietary">{dietaryMeta[tag].label}</Badge>
        </li>
      ))}
    </ul>
  );
}
