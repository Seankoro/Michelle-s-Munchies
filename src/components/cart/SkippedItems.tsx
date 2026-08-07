import Link from "next/link";
import type { SkippedLine } from "@/lib/cart-resolve";

/**
 * Renders a comma-separated run of skipped reorder/share lines, each a link back
 * to where it can be re-added (a bundle, a build-a-box, or a product page) when
 * we have one, or plain text when we don't.
 */
export function SkippedItems({ items }: { items: SkippedLine[] }) {
  return (
    <>
      {items.map((item, index) => (
        <span key={index}>
          {index > 0 && ", "}
          {item.href ? (
            <Link
              href={item.href}
              className="font-semibold text-rose-ink underline hover:text-rose"
            >
              {item.name}
            </Link>
          ) : (
            item.name
          )}
        </span>
      ))}
    </>
  );
}
