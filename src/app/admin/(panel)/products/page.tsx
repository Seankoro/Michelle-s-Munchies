"use client";

import { useState, type ChangeEvent } from "react";
import Image from "next/image";
import { useAdmin } from "@/components/admin/AdminStore";
import { uploadProductImageAction } from "@/lib/admin-actions";
import { allergenMeta, dietaryMeta, formatPrice } from "@/lib/catalog";
import type { Allergen, DietaryTag, FlavourBoxConfig, IngredientLine, Product } from "@/lib/types";
import { cn } from "@/lib/cn";
import { Toggle } from "@/components/ui/Toggle";
import { AdminModal } from "@/components/admin/AdminModal";
import { TableStateRow } from "@/components/admin/TableStateRow";
import { slugify } from "@/lib/text";
import { compactInputClass as inputClass } from "@/lib/ui";

const ALL_ALLERGENS = Object.keys(allergenMeta) as Allergen[];
const ALL_DIETARY = Object.keys(dietaryMeta) as DietaryTag[];
/** Column count of the products table, so the state-row colSpan is defined once. */
const TABLE_COLUMNS = 7;

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
    flavourBox: null,
    personalisation: null,
  };
}

export default function AdminProductsPage() {
  const {
    products,
    hydrated,
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
            {!hydrated && (
              <TableStateRow colSpan={TABLE_COLUMNS}>Loading products…</TableStateRow>
            )}
            {hydrated && products.length === 0 && (
              <TableStateRow colSpan={TABLE_COLUMNS}>
                No products yet. Tap “+ Add product” to create your first treat.
              </TableStateRow>
            )}
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
  const [costText, setCostText] = useState(
    product.costCents != null ? (product.costCents / 100).toFixed(2) : "",
  );
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

  // ---- Ingredients (name is customer-facing; amount + unit feed the shopping list) ----
  function addIngredientRow() {
    setDraft((prev) => ({
      ...prev,
      ingredients: [...(prev.ingredients ?? []), { name: "", amount: null, unit: null }],
    }));
  }
  function updateIngredient(index: number, patch: Partial<IngredientLine>) {
    setDraft((prev) => ({
      ...prev,
      ingredients: (prev.ingredients ?? []).map((ing, i) =>
        i === index ? { ...ing, ...patch } : ing,
      ),
    }));
  }
  function removeIngredient(index: number) {
    setDraft((prev) => ({
      ...prev,
      ingredients: (prev.ingredients ?? []).filter((_, i) => i !== index),
    }));
  }

  // ---- Per-item build-your-own box sizes ----
  function addBoxSize() {
    setDraft((prev) => {
      const fb = prev.flavourBox ?? { flavourOption: "Flavour", sizes: [] };
      return {
        ...prev,
        flavourBox: { ...fb, sizes: [...fb.sizes, { label: "", count: 6, priceCents: 0 }] },
      };
    });
  }
  function updateBoxSize(index: number, patch: Partial<FlavourBoxConfig["sizes"][number]>) {
    setDraft((prev) =>
      prev.flavourBox
        ? {
            ...prev,
            flavourBox: {
              ...prev.flavourBox,
              sizes: prev.flavourBox.sizes.map((s, i) => (i === index ? { ...s, ...patch } : s)),
            },
          }
        : prev,
    );
  }
  function removeBoxSize(index: number) {
    setDraft((prev) =>
      prev.flavourBox
        ? {
            ...prev,
            flavourBox: {
              ...prev.flavourBox,
              sizes: prev.flavourBox.sizes.filter((_, i) => i !== index),
            },
          }
        : prev,
    );
  }

  function handleSave() {
    const cents = Math.max(0, Math.round(parseFloat(priceText || "0") * 100));
    const costCents = costText.trim()
      ? Math.max(0, Math.round(parseFloat(costText) * 100))
      : null;
    const slug = draft.slug.trim() || slugify(draft.name);
    // Drop blank rows and normalise, so the stored recipe stays tidy.
    const ingredients = (draft.ingredients ?? [])
      .map((ing) => ({
        name: ing.name.trim(),
        amount: ing.amount != null && ing.amount > 0 ? ing.amount : null,
        unit: ing.unit?.trim() || null,
      }))
      .filter((ing) => ing.name);
    onSave({ ...draft, basePriceCents: cents, costCents, slug, ingredients });
  }

  return (
    <AdminModal
      onClose={onClose}
      ariaLabel={isNew ? "Add product" : `Edit ${product.name}`}
      title={
        <h2 className="font-display text-xl font-semibold">
          {isNew ? "Add product" : "Edit product"}
        </h2>
      }
    >
        <div className="flex flex-col gap-4">
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
              Cost to make (S$)
              <input
                className={inputClass}
                value={costText}
                onChange={(e) => setCostText(e.target.value)}
                inputMode="decimal"
                placeholder="Optional"
              />
              <span className="font-normal text-muted">
                Ingredients + packaging, just for your margin figures. Never shown to customers.
              </span>
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
              placeholder="e.g. Crustless burnt Basque cheesecake, 15 cm round"
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
            {uploadError && <p className="mt-1 text-sm text-danger">{uploadError}</p>}
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

          <fieldset>
            <legend className="text-sm font-semibold">Ingredients</legend>
            <p className="mt-1 text-xs text-muted">
              Customers see the names on the product page. The amount and unit are just for you, so
              the shopping list can total how much to buy. Leave the amount blank to skip totalling.
            </p>
            <div className="mt-3 flex flex-col gap-2">
              {(draft.ingredients ?? []).map((ing, index) => (
                <div key={index} className="flex flex-wrap items-center gap-2">
                  <input
                    className={cn(inputClass, "min-w-32 flex-1")}
                    value={ing.name}
                    onChange={(e) => updateIngredient(index, { name: e.target.value })}
                    placeholder="Ingredient, e.g. flour"
                  />
                  <input
                    type="number"
                    step="any"
                    min="0"
                    className={cn(inputClass, "w-20")}
                    value={ing.amount ?? ""}
                    onChange={(e) =>
                      updateIngredient(index, {
                        amount: e.target.value.trim()
                          ? Math.max(0, parseFloat(e.target.value) || 0)
                          : null,
                      })
                    }
                    placeholder="Amt"
                    aria-label="Amount per treat"
                  />
                  <input
                    className={cn(inputClass, "w-24")}
                    value={ing.unit ?? ""}
                    onChange={(e) => updateIngredient(index, { unit: e.target.value })}
                    placeholder="Unit, e.g. g"
                    aria-label="Unit"
                  />
                  <button
                    type="button"
                    onClick={() => removeIngredient(index)}
                    aria-label="Remove ingredient"
                    className="rounded-full p-2 text-muted transition hover:bg-blush-soft active:scale-90"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={addIngredientRow}
              className="mt-2 rounded-full border border-line px-4 py-1.5 text-sm font-semibold transition hover:border-rose active:scale-95"
            >
              + Add ingredient
            </button>
          </fieldset>

          <fieldset>
            <legend className="text-sm font-semibold">Personalisation</legend>
            <p className="mt-1 text-xs text-muted">
              Let customers add a short message to this treat, like a name to pipe on a cake. Leave
              the prompt blank to keep it off.
            </p>
            <label className="mt-2 flex flex-col gap-1 text-sm font-semibold">
              Prompt shown to customers
              <input
                className={inputClass}
                value={draft.personalisation?.label ?? ""}
                onChange={(e) =>
                  set(
                    "personalisation",
                    e.target.value.trim()
                      ? { label: e.target.value, allowPhoto: draft.personalisation?.allowPhoto ?? false }
                      : null,
                  )
                }
                placeholder="e.g. Message to pipe on top"
              />
            </label>
            {draft.personalisation && (
              <label className="mt-3 flex items-center gap-2 text-sm font-semibold">
                <Toggle
                  checked={draft.personalisation.allowPhoto}
                  onChange={(v) =>
                    set("personalisation", {
                      label: draft.personalisation?.label ?? "",
                      allowPhoto: v,
                    })
                  }
                  label="Allow a reference photo"
                />
                Allow a reference photo
              </label>
            )}
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
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted transition hover:bg-blush-soft active:scale-90"
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

          <fieldset className="rounded-xl bg-marble/40 p-3">
            <legend className="px-1 text-sm font-semibold">Build your own box</legend>
            <p className="text-xs text-muted">
              A box of this one item where the customer picks their own flavours.
            </p>
            <label className="mt-2 flex items-center gap-2 text-xs font-semibold">
              <Toggle
                checked={!!draft.flavourBox}
                onChange={(v) =>
                  set("flavourBox", v ? draft.flavourBox ?? { flavourOption: "Flavour", sizes: [] } : null)
                }
                label="Sell as a build-your-own box"
              />
              Let customers pick their own flavours
            </label>
            {draft.flavourBox && (
              <div className="mt-3 flex flex-col gap-3">
                <label className="flex flex-col gap-1 text-xs font-semibold">
                  Flavour option to pick from
                  <input
                    className={inputClass}
                    value={draft.flavourBox.flavourOption}
                    onChange={(e) =>
                      set("flavourBox", { ...draft.flavourBox!, flavourOption: e.target.value })
                    }
                    placeholder="Flavour"
                  />
                  <span className="font-normal text-muted">
                    Must match an option group name above, usually Flavour.
                  </span>
                </label>
                {draft.flavourBox.sizes.map((size, sizeIndex) => (
                  <div key={sizeIndex} className="flex flex-wrap items-center gap-2">
                    <input
                      className={cn(inputClass, "min-w-28 flex-1")}
                      value={size.label}
                      onChange={(e) => updateBoxSize(sizeIndex, { label: e.target.value })}
                      placeholder="Size label, e.g. Box of 6"
                    />
                    <label className="flex items-center gap-1 text-xs text-muted">
                      Count
                      <input
                        type="number"
                        min="1"
                        step="1"
                        className={cn(inputClass, "w-16")}
                        value={size.count}
                        onChange={(e) =>
                          updateBoxSize(sizeIndex, {
                            count: Math.max(1, Math.round(parseFloat(e.target.value) || 1)),
                          })
                        }
                      />
                    </label>
                    <label className="flex items-center gap-1 text-xs text-muted">
                      S$
                      <input
                        type="number"
                        min="0"
                        step="0.5"
                        className={cn(inputClass, "w-20")}
                        value={size.priceCents / 100}
                        onChange={(e) =>
                          updateBoxSize(sizeIndex, {
                            priceCents: Math.max(0, Math.round((parseFloat(e.target.value) || 0) * 100)),
                          })
                        }
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => removeBoxSize(sizeIndex)}
                      aria-label="Remove size"
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted transition hover:bg-blush-soft active:scale-90"
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addBoxSize}
                  className="self-start rounded-full border border-line px-3 py-1.5 text-xs font-semibold transition hover:border-rose active:scale-95"
                >
                  + Add box size
                </button>
              </div>
            )}
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
    </AdminModal>
  );
}
