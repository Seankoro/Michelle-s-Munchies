"use client";

import { useMemo, useState } from "react";
import type { CartItem, Product, SelectedOption } from "@/lib/types";
import { formatPrice } from "@/lib/catalog";
import { useCart } from "@/components/cart/CartContext";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";

/**
 * Shared option + quantity selector that adds to the cart. Reused inline on the
 * product detail page and inside the quick-pick popover, so the "choose size /
 * flavour / quantity" experience is identical everywhere.
 */
export function OptionPicker({
  product,
  onAdded,
  className,
}: {
  product: Product;
  onAdded?: () => void;
  className?: string;
}) {
  const { addItem } = useCart();

  // Pre-select the first value of each option for a smoother first tap.
  const [selected, setSelected] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const option of product.options) {
      // Pre-select the first available value, so a sold-out flavour is never
      // the default pick. Fall back to the first value if all are sold out.
      const firstPick = option.values.find((v) => v.isAvailable !== false) ?? option.values[0];
      if (firstPick) initial[option.id] = firstPick.id;
    }
    return initial;
  });
  const [quantity, setQuantity] = useState(1);

  const unitPriceCents = useMemo(() => {
    let price = product.basePriceCents;
    for (const option of product.options) {
      const value = option.values.find((v) => v.id === selected[option.id]);
      if (value) price += value.priceDeltaCents;
    }
    return price;
  }, [product, selected]);

  const allRequiredChosen = product.options.every(
    (option) => !option.required || selected[option.id],
  );

  // Every chosen value must still be in stock, in case a flavour sold out while
  // the popover was open or all values of a group are unavailable.
  const selectionAvailable = product.options.every((option) => {
    const value = option.values.find((v) => v.id === selected[option.id]);
    return !value || value.isAvailable !== false;
  });

  function handleAdd() {
    if (!product.isAvailable || !allRequiredChosen || !selectionAvailable) return;

    const selectedOptions: SelectedOption[] = product.options.map((option) => {
      const value = option.values.find((v) => v.id === selected[option.id]);
      return {
        optionName: option.name,
        valueLabel: value?.label ?? "",
        priceDeltaCents: value?.priceDeltaCents ?? 0,
      };
    });

    const key = `${product.id}::${product.options
      .map((option) => selected[option.id] ?? "")
      .join("|")}`;

    const item: CartItem = {
      key,
      productId: product.id,
      slug: product.slug,
      name: product.name,
      unitPriceCents,
      quantity,
      selectedOptions,
    };

    addItem(item);
    onAdded?.();
  }

  return (
    <div className={cn("flex flex-col gap-5", className)}>
      {product.options.map((option) => (
        <fieldset key={option.id}>
          <legend className="mb-2 text-sm font-semibold text-ink">
            {option.name}
            {option.required && <span className="ml-1 text-rose">*</span>}
          </legend>
          <div className="flex flex-wrap gap-2">
            {option.values.map((value) => {
              const isSelected = selected[option.id] === value.id;
              const disabled = value.isAvailable === false;
              return (
                <button
                  key={value.id}
                  type="button"
                  disabled={disabled}
                  aria-pressed={isSelected}
                  onClick={() =>
                    setSelected((prev) => ({ ...prev, [option.id]: value.id }))
                  }
                  className={cn(
                    "rounded-full border px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50",
                    isSelected
                      ? "border-rose-deep bg-blush-soft text-rose-deep"
                      : "border-line bg-white text-ink hover:border-rose",
                  )}
                >
                  {value.label}
                  {value.priceDeltaCents > 0 && (
                    <span className="ml-1 text-muted">
                      +{formatPrice(value.priceDeltaCents)}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </fieldset>
      ))}

      {/* Quantity */}
      <div className="flex items-center gap-3">
        <span className="text-sm font-semibold text-ink">Quantity</span>
        <div className="inline-flex items-center rounded-full border border-line bg-white">
          <button
            type="button"
            aria-label="Decrease quantity"
            onClick={() => setQuantity((q) => Math.max(1, q - 1))}
            className="flex h-9 w-9 items-center justify-center rounded-full text-lg text-ink hover:bg-blush-soft"
          >
            −
          </button>
          <span className="w-8 text-center font-semibold" aria-live="polite">
            {quantity}
          </span>
          <button
            type="button"
            aria-label="Increase quantity"
            onClick={() => setQuantity((q) => q + 1)}
            className="flex h-9 w-9 items-center justify-center rounded-full text-lg text-ink hover:bg-blush-soft"
          >
            +
          </button>
        </div>
      </div>

      <Button
        onClick={handleAdd}
        disabled={!product.isAvailable || !allRequiredChosen || !selectionAvailable}
        className="w-full"
      >
        {!product.isAvailable
          ? "Sold out"
          : !selectionAvailable
            ? "Flavour sold out"
            : `Add to cart · ${formatPrice(unitPriceCents * quantity)}`}
      </Button>
    </div>
  );
}
