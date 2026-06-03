"use client";

import { useRef, useState, type ChangeEvent } from "react";
import Image from "next/image";
import { useAdmin } from "@/components/admin/AdminStore";
import { uploadProductImageAction } from "@/lib/admin-actions";
import { allergenMeta, dietaryMeta, formatPrice } from "@/lib/catalog";
import type { Allergen, DietaryTag, Product } from "@/lib/types";
import { cn } from "@/lib/cn";
import { Toggle } from "@/components/ui/Toggle";
import { useDialog } from "@/lib/useDialog";
import { slugify } from "@/lib/text";
import { compactInputClass as inputClass } from "@/lib/ui";

const ALL_ALLERGENS = Object.keys(allergenMeta) as Allergen[];
const ALL_DIETARY = Object.keys(dietaryMeta) as DietaryTag[];

/** ISO timestamp → value for a <input type="datetime-local">, in local time. */
function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function blankProduct(): Product {
  return {
    id: `p-${Date.now()}`,
    slug: "",
    name: "",
    shortDescription: "",
    longDescription: "",
    basePriceCents: 0,
    category: "Cookies",
    isAvailable: true,
    isBestSeller: false,
    isRecommended: false,
    allergens: [],
    dietaryTags: [],
    ingredients: [],
    storageInfo: "",
    servingInfo: "",
    imageUrls: [],
    photoCount: 1,
    options: [],
  };
}

export default function AdminProductsPage() {
  const {
    products,
    toggleAvailability,
    toggleBestSeller,
    toggleRecommended,
    updateProduct,
    addProduct,
    deleteProduct,
  } = useAdmin();
  const [editing, setEditing] = useState<Product | null>(null);
  const [isNew, setIsNew] = useState(false);

  function openNew() {
    setEditing(blankProduct());
    setIsNew(true);
  }
  function openEdit(product: Product) {
    setEditing(product);
    setIsNew(false);
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold">Products</h1>
          <p className="mt-1 text-muted">Manage the menu, availability, and what&rsquo;s featured.</p>
        </div>
        <button
          type="button"
          onClick={openNew}
          className="rounded-full bg-rose-deep px-5 py-2.5 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:brightness-110 active:scale-95"
        >
          + Add product
        </button>
      </div>

      <div className="mt-6 overflow-x-auto rounded-2xl border border-line bg-white">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="border-b border-line bg-marble/40 text-muted">
            <tr>
              <th className="px-4 py-3 font-semibold">Product</th>
              <th className="px-4 py-3 font-semibold">Category</th>
              <th className="px-4 py-3 font-semibold">Price</th>
              <th className="px-4 py-3 text-center font-semibold">Available</th>
              <th className="px-4 py-3 text-center font-semibold">Best seller</th>
              <th className="px-4 py-3 text-center font-semibold">Recommended</th>
              <th className="px-4 py-3 font-semibold"></th>
            </tr>
          </thead>
          <tbody>
            {products.map((product) => (
              <tr key={product.id} className="border-b border-line last:border-0">
                <td className="px-4 py-3 font-semibold">{product.name || "(untitled)"}</td>
                <td className="px-4 py-3 text-muted">{product.category}</td>
                <td className="px-4 py-3">{formatPrice(product.basePriceCents)}</td>
                <td className="px-4 py-3 text-center">
                  <Toggle
                    checked={product.isAvailable}
                    onChange={() => toggleAvailability(product.id)}
                    label={`Toggle availability for ${product.name}`}
                  />
                </td>
                <td className="px-4 py-3 text-center">
                  <Toggle
                    checked={product.isBestSeller}
                    onChange={() => toggleBestSeller(product.id)}
                    label={`Toggle best seller for ${product.name}`}
                  />
                </td>
                <td className="px-4 py-3 text-center">
                  <Toggle
                    checked={product.isRecommended}
                    onChange={() => toggleRecommended(product.id)}
                    label={`Toggle recommended for ${product.name}`}
                  />
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => openEdit(product)}
                      className="rounded-full border border-line px-3 py-1.5 text-xs font-semibold transition hover:border-rose active:scale-95"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm(`Delete "${product.name}"? This can't be undone.`)) {
                          deleteProduct(product.id);
                        }
                      }}
                      className="rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-rose-deep transition hover:border-rose active:scale-95"
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <ProductFormModal
          product={editing}
          isNew={isNew}
          onClose={() => setEditing(null)}
          onSave={(saved) => {
            if (isNew) addProduct(saved);
            else updateProduct(saved.id, saved);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function ProductFormModal({
  product,
  isNew,
  onClose,
  onSave,
}: {
  product: Product;
  isNew: boolean;
  onClose: () => void;
  onSave: (product: Product) => void;
}) {
  const [draft, setDraft] = useState<Product>(product);
  const [priceText, setPriceText] = useState((product.basePriceCents / 100).toFixed(2));
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  function set<K extends keyof Product>(key: K, value: Product[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ""; // allow re-selecting the same file
    if (!file) return;
    setUploadError(null);
    setUploading(true);
    const fd = new FormData();
    fd.append("file", file);
    const result = await uploadProductImageAction(fd);
    setUploading(false);
    if (!result.ok) {
      setUploadError(result.error);
      return;
    }
    setDraft((prev) => ({ ...prev, imageUrls: [...(prev.imageUrls ?? []), result.url] }));
  }

  function toggleArray<T>(list: T[], value: T): T[] {
    return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  }

  // ---- Option group + flavour editing ----
  function addOption() {
    setDraft((prev) => ({
      ...prev,
      options: [
        ...prev.options,
        { id: `o-${crypto.randomUUID()}`, name: "", required: true, values: [] },
      ],
    }));
  }
  function updateOption(index: number, patch: Partial<Product["options"][number]>) {
    setDraft((prev) => ({
      ...prev,
      options: prev.options.map((o, i) => (i === index ? { ...o, ...patch } : o)),
    }));
  }
  function removeOption(index: number) {
    setDraft((prev) => ({ ...prev, options: prev.options.filter((_, i) => i !== index) }));
  }
  function addValue(optionIndex: number) {
    setDraft((prev) => ({
      ...prev,
      options: prev.options.map((o, i) =>
        i === optionIndex
          ? {
              ...o,
              values: [
                ...o.values,
                { id: `v-${crypto.randomUUID()}`, label: "", priceDeltaCents: 0, isAvailable: true },
              ],
            }
          : o,
      ),
    }));
  }
  function updateValue(
    optionIndex: number,
    valueIndex: number,
    patch: Partial<Product["options"][number]["values"][number]>,
  ) {
    setDraft((prev) => ({
      ...prev,
      options: prev.options.map((o, i) =>
        i === optionIndex
          ? { ...o, values: o.values.map((v, j) => (j === valueIndex ? { ...v, ...patch } : v)) }
          : o,
      ),
    }));
  }
  function removeValue(optionIndex: number, valueIndex: number) {
    setDraft((prev) => ({
      ...prev,
      options: prev.options.map((o, i) =>
        i === optionIndex ? { ...o, values: o.values.filter((_, j) => j !== valueIndex) } : o,
      ),
    }));
  }

  function handleSave() {
    const cents = Math.max(0, Math.round(parseFloat(priceText || "0") * 100));
    const slug = draft.slug.trim() || slugify(draft.name);
    onSave({ ...draft, basePriceCents: cents, slug });
  }

  const panelRef = useRef<HTMLDivElement>(null);
  useDialog(true, onClose, panelRef);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={isNew ? "Add product" : `Edit ${product.name}`}
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 sm:items-center sm:p-4"
    >
      <div
        ref={panelRef}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full max-w-lg animate-[fade-up_0.2s_ease-out] overflow-y-auto rounded-t-2xl bg-white p-6 shadow-soft sm:rounded-2xl"
      >
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl font-semibold">
            {isNew ? "Add product" : "Edit product"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-full p-2 text-muted transition hover:bg-blush-soft active:scale-90"
          >
            ✕
          </button>
        </div>

        <div className="mt-4 flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm font-semibold">
            Name
            <input
              className={inputClass}
              value={draft.name}
              onChange={(e) => set("name", e.target.value)}
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Category
              <input
                className={inputClass}
                value={draft.category}
                onChange={(e) => set("category", e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Base price (S$)
              <input
                className={inputClass}
                value={priceText}
                onChange={(e) => setPriceText(e.target.value)}
                inputMode="decimal"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Stock count
              <input
                className={inputClass}
                value={draft.stockCount == null ? "" : String(draft.stockCount)}
                onChange={(e) => {
                  const v = e.target.value.trim();
                  const n = parseInt(v, 10);
                  set("stockCount", v === "" || !Number.isFinite(n) ? null : Math.max(0, n));
                }}
                inputMode="numeric"
                placeholder="Untracked"
              />
              <span className="font-normal text-muted">Blank = untracked. Auto sold-out at 0.</span>
            </label>
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Available from (seasonal drop)
              <input
                type="datetime-local"
                className={inputClass}
                value={isoToLocalInput(draft.availableFrom)}
                onChange={(e) =>
                  set("availableFrom", e.target.value ? new Date(e.target.value).toISOString() : null)
                }
              />
              <span className="font-normal text-muted">Blank = available now. A future time shows a countdown and waitlist.</span>
            </label>
          </div>

          <label className="flex flex-col gap-1 text-sm font-semibold">
            Short description
            <input
              className={inputClass}
              value={draft.shortDescription}
              onChange={(e) => set("shortDescription", e.target.value)}
              placeholder="e.g. Fudgy chocolate brownie, 18 cm tray"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm font-semibold">
            Full description
            <textarea
              className={cn(inputClass, "min-h-20 resize-y")}
              value={draft.longDescription}
              onChange={(e) => set("longDescription", e.target.value)}
              placeholder="Describe the treat. Use metric for sizes and weights, like 20 cm round or 500 g."
            />
            <span className="text-xs font-normal text-muted">
              Use metric units like cm, g, and ml for any sizes or weights.
            </span>
          </label>

          <div>
            <span className="text-sm font-semibold">Photos</span>
            <div className="mt-2 flex flex-wrap gap-3">
              {(draft.imageUrls ?? []).map((url) => (
                <div
                  key={url}
                  className="relative h-20 w-20 overflow-hidden rounded-xl border border-line"
                >
                  <Image src={url} alt="Product photo" fill sizes="80px" className="object-cover" />
                  <button
                    type="button"
                    aria-label="Remove photo"
                    onClick={() =>
                      set("imageUrls", (draft.imageUrls ?? []).filter((u) => u !== url))
                    }
                    className="absolute right-0 top-0 rounded-bl-lg bg-ink/60 px-1.5 text-xs font-semibold text-white transition hover:bg-ink active:scale-90"
                  >
                    ✕
                  </button>
                </div>
              ))}
              <label
                className={cn(
                  "flex h-20 w-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-blush text-xs font-semibold text-rose-deep",
                  uploading && "opacity-60",
                )}
              >
                {uploading ? "Uploading…" : "+ Add"}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleUpload}
                  disabled={uploading}
                />
              </label>
            </div>
            {uploadError && <p className="mt-1 text-sm text-red-600">{uploadError}</p>}
          </div>

          <fieldset>
            <legend className="text-sm font-semibold">Allergens</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {ALL_ALLERGENS.map((allergen) => (
                <button
                  key={allergen}
                  type="button"
                  onClick={() => set("allergens", toggleArray(draft.allergens, allergen))}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-xs font-semibold transition active:scale-95",
                    draft.allergens.includes(allergen)
                      ? "border-rose-deep bg-blush-soft text-rose-deep"
                      : "border-line bg-white text-ink hover:border-rose",
                  )}
                >
                  {allergenMeta[allergen].icon} {allergenMeta[allergen].label}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="text-sm font-semibold">Dietary tags</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {ALL_DIETARY.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => set("dietaryTags", toggleArray(draft.dietaryTags, tag))}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-xs font-semibold transition active:scale-95",
                    draft.dietaryTags.includes(tag)
                      ? "border-rose-deep bg-blush-soft text-rose-deep"
                      : "border-line bg-white text-ink hover:border-rose",
                  )}
                >
                  {dietaryMeta[tag].label}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="flex flex-wrap gap-4 rounded-xl bg-marble/40 p-3 text-sm">
            <div className="flex items-center gap-2 font-semibold">
              <Toggle
                checked={draft.isAvailable}
                onChange={(v) => set("isAvailable", v)}
                label="Available"
              />
              Available
            </div>
            <div className="flex items-center gap-2 font-semibold">
              <Toggle
                checked={draft.isBestSeller}
                onChange={(v) => set("isBestSeller", v)}
                label="Best seller"
              />
              Best seller
            </div>
            <div className="flex items-center gap-2 font-semibold">
              <Toggle
                checked={draft.isRecommended}
                onChange={(v) => set("isRecommended", v)}
                label="Recommended"
              />
              Recommended
            </div>
          </div>

          <fieldset>
            <legend className="text-sm font-semibold">Options and flavours</legend>
            <p className="mt-1 text-xs text-muted">
              Add a group like Flavour or Size, then its choices. Turn a choice off to mark it sold
              out on the menu without removing it.
            </p>
            <div className="mt-3 flex flex-col gap-4">
              {draft.options.map((option, optionIndex) => (
                <div key={option.id} className="rounded-xl border border-line p-3">
                  <div className="flex items-center gap-2">
                    <input
                      className={inputClass}
                      value={option.name}
                      onChange={(e) => updateOption(optionIndex, { name: e.target.value })}
                      placeholder="Group name, e.g. Flavour"
                    />
                    <button
                      type="button"
                      onClick={() => removeOption(optionIndex)}
                      aria-label="Remove group"
                      className="rounded-full p-2 text-muted transition hover:bg-blush-soft active:scale-90"
                    >
                      ✕
                    </button>
                  </div>
                  <label className="mt-2 flex items-center gap-2 text-xs font-semibold">
                    <Toggle
                      checked={option.required}
                      onChange={(v) => updateOption(optionIndex, { required: v })}
                      label="Required choice"
                    />
                    Required choice
                  </label>

                  <div className="mt-3 flex flex-col gap-2">
                    {option.values.map((value, valueIndex) => (
                      <div key={value.id} className="flex flex-wrap items-center gap-2">
                        <input
                          className={cn(inputClass, "min-w-32 flex-1")}
                          value={value.label}
                          onChange={(e) =>
                            updateValue(optionIndex, valueIndex, { label: e.target.value })
                          }
                          placeholder="Choice, e.g. Pistachio"
                        />
                        <div className="flex items-center gap-1 text-sm">
                          <span className="text-muted">+ S$</span>
                          <input
                            type="number"
                            step="0.5"
                            min="0"
                            className={cn(inputClass, "w-20")}
                            value={value.priceDeltaCents / 100}
                            onChange={(e) =>
                              updateValue(optionIndex, valueIndex, {
                                priceDeltaCents: Math.max(
                                  0,
                                  Math.round((parseFloat(e.target.value) || 0) * 100),
                                ),
                              })
                            }
                          />
                        </div>
                        <label className="flex items-center gap-1 text-xs font-semibold">
                          <Toggle
                            checked={value.isAvailable !== false}
                            onChange={(v) =>
                              updateValue(optionIndex, valueIndex, { isAvailable: v })
                            }
                            label={`In stock ${value.label || "choice"}`}
                          />
                          In stock
                        </label>
                        <button
                          type="button"
                          onClick={() => removeValue(optionIndex, valueIndex)}
                          aria-label="Remove choice"
                          className="rounded-full p-1.5 text-muted transition hover:bg-blush-soft active:scale-90"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => addValue(optionIndex)}
                      className="self-start rounded-full border border-line px-3 py-1.5 text-xs font-semibold transition hover:border-rose active:scale-95"
                    >
                      + Add choice
                    </button>
                  </div>
                </div>
              ))}
              <button
                type="button"
                onClick={addOption}
                className="self-start rounded-full border border-dashed border-blush px-4 py-2 text-xs font-semibold text-rose-deep transition hover:border-rose active:scale-95"
              >
                + Add option group
              </button>
            </div>
          </fieldset>
        </div>

        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-full border border-line px-4 py-2.5 text-sm font-semibold transition hover:border-rose active:scale-95"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!draft.name.trim()}
            className="flex-1 rounded-full bg-rose-deep px-4 py-2.5 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:brightness-110 active:scale-95 disabled:opacity-50"
          >
            {isNew ? "Add product" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
