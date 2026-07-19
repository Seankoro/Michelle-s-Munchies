import type { Product } from "@/lib/types";
import { ProductCard } from "@/components/product/ProductCard";
import { ScrollRail } from "@/components/ui/ScrollRail";

/**
 * Recommendations carousel. A scroll-snap rail with a peeking next card,
 * browsable by swipe, arrows, or the slider via ScrollRail; at xl the same
 * products render as a static grid so desktop is not a mobile afterthought.
 */
export function RecommendationRail({ products }: { products: Product[] }) {
  return (
    <ScrollRail
      label="Recommended treats"
      trackClassName="relative -mx-6 flex gap-4 overflow-x-auto px-6 pb-2 no-scrollbar xl:mx-0 xl:grid xl:grid-cols-4 xl:gap-6 xl:overflow-visible xl:px-0 xl:pb-0"
    >
      {products.map((product) => (
        <div
          key={product.id}
          className="shrink-0 basis-[78%] snap-start sm:basis-[46%] lg:basis-[31%] xl:basis-auto"
        >
          <ProductCard product={product} />
        </div>
      ))}
    </ScrollRail>
  );
}
