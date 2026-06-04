"use client";

import { RibbonBow } from "@/components/ui/RibbonBow";
import { useWishlist } from "./WishlistContext";
import { useFeatures } from "@/components/features/FeaturesProvider";
import { subscribeBackInStockAction } from "@/lib/stock-actions";
import { cn } from "@/lib/cn";

/**
 * A ribbon you "tie" to favourite a product. Hidden for signed-out visitors.
 * Tying the ribbon on a sold-out item also subscribes you to its back-in-stock
 * alert when that feature is on.
 */
export function FavouriteButton({
  productId,
  className,
  soldOut = false,
}: {
  productId: string;
  className?: string;
  soldOut?: boolean;
}) {
  const { wishlist, backInStock } = useFeatures();
  const { ready, signedIn, isFavourite, toggle } = useWishlist();
  if (!wishlist || !ready || !signedIn) return null;

  const favourite = isFavourite(productId);
  return (
    <button
      type="button"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        const willFavourite = !favourite;
        toggle(productId);
        // Ribbon on a sold-out treat = "tell me when it's back".
        if (willFavourite && soldOut && backInStock) {
          void subscribeBackInStockAction(productId, "");
        }
      }}
      aria-pressed={favourite}
      aria-label={favourite ? "Remove from favourites" : "Save to favourites"}
      title={favourite ? "Remove from favourites" : "Save to favourites"}
      className={cn(
        "inline-flex items-center justify-center rounded-full border border-line bg-white/90 p-2 shadow-soft backdrop-blur transition hover:bg-blush-soft",
        className,
      )}
    >
      <RibbonBow
        withTails={false}
        className={cn("h-5 w-6 transition", favourite ? "" : "opacity-30 saturate-0")}
      />
    </button>
  );
}
