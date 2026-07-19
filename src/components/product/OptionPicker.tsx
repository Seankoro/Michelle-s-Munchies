"use client";

import { useMemo, useState, type ChangeEvent } from "react";
import type { CartItem, Personalisation, Product, SelectedOption } from "@/lib/types";
import { formatPrice } from "@/lib/catalog";
import { useCart } from "@/components/cart/CartContext";
import { menuCartKey } from "@/lib/cart-key";
import { uploadPersonalisationImageAction } from "@/lib/personalisation-actions";
import { Button } from "@/components/ui/Button";
import { compactInputClass } from "@/lib/ui";
import { cn } from "@/lib/cn";

/**
 * Shared option + quantity selector that adds to the cart. Reused inline on the
 * product detail page and inside the quick-pick popover, so the "choose size /
 * flavour / quantity" experience is identical everywhere. `allowPersonalisation`
 * is passed only on the full detail page, so quick-pick stays a fast one-tap add.
 */
export function OptionPicker({
  product,
  onAdded,
  allowPersonalisation = false,
}: {
  product: Product;
  onAdded?: () => void;
  allowPersonalisation?: boolean;
}) {
  const { addItem } = useCart();
  const personalisation = allowPersonalisation ? product.personalisation ?? null : null;
  const [message, setMessage] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [photoError, setPhotoError] = useState("");

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
  // Brief "Added" confirmation, so the primary buy button on the product page
  // never reads as a dead tap. QuickPick passes onAdded and swaps the whole
  // view, so this only shows where the picker stays mounted.
  const [added, setAdded] = useState(false);

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

  async function handlePhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ""; // allow re-selecting the same file
    if (!file) return;
    setPhotoError("");
    setUploading(true);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("productId", product.id);
    const result = await uploadPersonalisationImageAction(fd);
    setUploading(false);
    if (result.ok) setPhotoUrl(result.url);
    else setPhotoError(result.error);
  }

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

    const trimmedMessage = message.trim();
    const chosen: Personalisation | undefined =
      personalisation && (trimmedMessage || photoUrl)
        ? { message: trimmedMessage || undefined, photoUrl: photoUrl || undefined }
        : undefined;

    // Options key, exactly how the cart merges menu adds. A personalised line
    // carries a unique suffix so two different messages never merge into one.
    const optionsKey = menuCartKey(
      product.id,
      product.options.map((option) => selected[option.id] ?? ""),
    );
    const key = chosen ? `${optionsKey}::p-${crypto.randomUUID()}` : optionsKey;

    const item: CartItem = {
      key,
      productId: product.id,
      slug: product.slug,
      name: product.name,
      unitPriceCents,
      quantity,
      selectedOptions,
      imageUrl: product.imageUrls?.[0],
      ...(chosen ? { personalisation: chosen } : {}),
    };

    addItem(item);
    setAdded(true);
    setMessage("");
    setPhotoUrl("");
    window.setTimeout(() => setAdded(false), 1600);
    onAdded?.();
  }

  return (
    <div className="flex flex-col gap-5">
      {product.options.map((option) => (
        <fieldset key={option.id}>
          <legend className="mb-2 text-sm font-semibold text-ink">
            {option.name}
            {option.required && <span className="ml-1 text-rose-deep">*</span>}
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

      {personalisation && (
        <div className="flex flex-col gap-2 rounded-xl border border-line bg-white p-4">
          <label className="flex flex-col gap-1 text-sm font-semibold text-ink">
            {personalisation.label}
            <span className="font-normal text-muted">Optional, we&rsquo;ll do our best 🎀</span>
            <input
              className={compactInputClass}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={120}
              placeholder="e.g. Happy Birthday Mum!"
            />
          </label>
          {personalisation.allowPhoto && (
            <div className="text-sm">
              <span className="font-semibold text-ink">Reference photo</span>
              <div className="mt-1 flex items-center gap-3">
                {photoUrl ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={photoUrl}
                      alt="Your reference"
                      className="h-14 w-14 rounded-lg border border-line object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => setPhotoUrl("")}
                      className="text-xs font-semibold text-muted transition hover:text-rose-deep"
                    >
                      Remove
                    </button>
                  </>
                ) : (
                  <label
                    className={cn(
                      "cursor-pointer rounded-full border border-line px-4 py-1.5 text-xs font-semibold transition hover:border-rose",
                      uploading && "opacity-60",
                    )}
                  >
                    {uploading ? "Uploading…" : "+ Add a photo"}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handlePhoto}
                      disabled={uploading}
                    />
                  </label>
                )}
              </div>
              {photoError && <p className="mt-1 text-xs text-rose-deep">{photoError}</p>}
            </div>
          )}
        </div>
      )}

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
            : added
              ? "Added ✓"
              : `Add to cart · ${formatPrice(unitPriceCents * quantity)}`}
      </Button>
      <span className="sr-only" role="status" aria-live="polite">
        {added ? `Added ${quantity} ${product.name} to your cart.` : ""}
      </span>
    </div>
  );
}
