"use client";

import { useEffect, useRef, useState } from "react";
import { useDialog } from "@/lib/useDialog";
import { useAdmin } from "@/components/admin/AdminStore";
import {
  loadBoxTemplatesAction,
  createBoxTemplateAction,
  updateBoxTemplateAction,
  deleteBoxTemplateAction,
} from "@/lib/admin-actions";
import type { AdminBoxTemplate } from "@/lib/admin-merch";
import { formatPrice } from "@/lib/catalog";
import { cn } from "@/lib/cn";
import { Toggle } from "@/components/ui/Toggle";
import { slugify } from "@/lib/text";
import { compactInputClass as inputClass } from "@/lib/ui";

type Draft = {
  id: string | null;
  name: string;
  slug: string;
  itemCountStr: string;
  priceStr: string;
  eligibleCategory: string;
  isActive: boolean;
  sortOrder: number;
  productIds: string[];
};


const emptyDraft: Draft = {
  id: null,
  name: "",
  slug: "",
  itemCountStr: "12",
  priceStr: "0.00",
  eligibleCategory: "",
  isActive: true,
  sortOrder: 0,
  productIds: [],
};

export default function AdminBoxesPage() {
  const { products, hydrated } = useAdmin();
  const [boxes, setBoxes] = useState<AdminBoxTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  useDialog(!!draft, () => setDraft(null), editorRef);
  const [error, setError] = useState("");

  async function refresh() {
    setLoading(true);
    try {
      setBoxes(await loadBoxTemplatesAction());
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
  }, []);

  function startEdit(b: AdminBoxTemplate) {
    setError("");
    setDraft({
      id: b.id,
      name: b.name,
      slug: b.slug,
      itemCountStr: String(b.itemCount),
      priceStr: (b.priceCents / 100).toFixed(2),
      eligibleCategory: b.eligibleCategory ?? "",
      isActive: b.isActive,
      sortOrder: b.sortOrder,
      productIds: b.productIds,
    });
  }

  async function save() {
    if (!draft) return;
    setError("");
    const input = {
      name: draft.name.trim(),
      slug: draft.slug.trim() || slugify(draft.name),
      itemCount: Math.max(1, parseInt(draft.itemCountStr || "1", 10)),
      priceCents: Math.max(0, Math.round(parseFloat(draft.priceStr || "0") * 100)),
      eligibleCategory: draft.eligibleCategory.trim() || null,
      isActive: draft.isActive,
      sortOrder: draft.sortOrder,
      productIds: draft.productIds,
    };
    const result = draft.id
      ? await updateBoxTemplateAction(draft.id, input)
      : await createBoxTemplateAction(input);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setDraft(null);
    await refresh();
  }

  async function remove(id: string) {
    await deleteBoxTemplateAction(id);
    await refresh();
  }

  function toggleProduct(id: string) {
    setDraft((d) =>
      d
        ? {
            ...d,
            productIds: d.productIds.includes(id)
              ? d.productIds.filter((p) => p !== id)
              : [...d.productIds, id],
          }
        : d,
    );
  }

  if (!hydrated || loading) return null;

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-3xl font-semibold">Build-a-box</h1>
        <button
          type="button"
          onClick={() => {
            setError("");
            setDraft({ ...emptyDraft });
          }}
          className="rounded-full bg-rose-deep px-4 py-2 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:brightness-110 active:scale-95"
        >
          + New box
        </button>
      </div>
      <p className="mt-1 text-muted">Mix-and-match boxes at a flat price.</p>

      <ul className="mt-6 flex flex-col gap-3">
        {boxes.length === 0 && <p className="text-sm text-muted">No boxes yet.</p>}
        {boxes.map((b) => (
          <li
            key={b.id}
            className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-white p-4"
          >
            <div>
              <p className="font-semibold">
                {b.name} {!b.isActive && <span className="text-xs text-muted">(hidden)</span>}
              </p>
              <p className="text-sm text-muted">
                Pick {b.itemCount} · {formatPrice(b.priceCents)} ·{" "}
                {b.productIds.length > 0 ? `${b.productIds.length} eligible` : b.eligibleCategory || "all products"}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => startEdit(b)}
                className="rounded-full border border-line px-3 py-1.5 text-sm font-semibold transition hover:border-rose active:scale-95"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => remove(b.id)}
                className="rounded-full border border-line px-3 py-1.5 text-sm font-semibold text-rose-deep transition hover:border-rose active:scale-95"
              >
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>

      {draft && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={draft.id ? "Edit box" : "New box"}
          onClick={() => setDraft(null)}
          className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 sm:items-center sm:p-4"
        >
          <div
            ref={editorRef}
            onClick={(e) => e.stopPropagation()}
            className="max-h-[90vh] w-full max-w-lg animate-[fade-up_0.2s_ease-out] overflow-y-auto rounded-t-2xl bg-white p-6 shadow-soft sm:rounded-2xl"
          >
            <div className="mb-2 flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold">{draft.id ? "Edit box" : "New box"}</h2>
              <button
                type="button"
                onClick={() => setDraft(null)}
                aria-label="Close"
                className="rounded-full p-2 text-muted transition hover:bg-blush-soft active:scale-90"
              >
                ✕
              </button>
            </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Name
              <input
                className={inputClass}
                value={draft.name}
                onChange={(e) =>
                  setDraft((d) =>
                    d ? { ...d, name: e.target.value, slug: d.slug || slugify(e.target.value) } : d,
                  )
                }
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Slug
              <input
                className={inputClass}
                value={draft.slug}
                onChange={(e) => setDraft((d) => (d ? { ...d, slug: e.target.value } : d))}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Items to pick
              <input
                className={inputClass}
                value={draft.itemCountStr}
                inputMode="numeric"
                onChange={(e) => setDraft((d) => (d ? { ...d, itemCountStr: e.target.value } : d))}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Price (S$)
              <input
                className={inputClass}
                value={draft.priceStr}
                inputMode="decimal"
                onChange={(e) => setDraft((d) => (d ? { ...d, priceStr: e.target.value } : d))}
              />
            </label>
          </div>
          <div className="mt-4 flex items-center gap-2 text-sm font-semibold">
            <Toggle
              checked={draft.isActive}
              onChange={(v) => setDraft((d) => (d ? { ...d, isActive: v } : d))}
              label="Active on the storefront"
            />
            Active (shown on the storefront)
          </div>

          <h3 className="mt-5 text-sm font-semibold text-ink">Eligible products</h3>
          <p className="text-sm text-muted">
            Tick the treats customers can choose. Leave all unticked to allow a whole category instead.
          </p>
          <div className="mt-2 grid gap-1 sm:grid-cols-2">
            {products.map((p) => (
              <label key={p.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={draft.productIds.includes(p.id)}
                  onChange={() => toggleProduct(p.id)}
                />
                {p.name}
              </label>
            ))}
          </div>
          <label className="mt-3 flex flex-col gap-1 text-sm font-semibold">
            …or eligible category (used only if no products are ticked)
            <input
              className={inputClass}
              value={draft.eligibleCategory}
              placeholder="e.g. Cookies"
              onChange={(e) => setDraft((d) => (d ? { ...d, eligibleCategory: e.target.value } : d))}
            />
          </label>

          {error && <p className="mt-3 text-sm text-rose-deep">{error}</p>}
          <div className="mt-5 flex gap-3">
            <button
              type="button"
              onClick={save}
              className="rounded-full bg-rose-deep px-5 py-2 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:brightness-110 active:scale-95"
            >
              Save box
            </button>
            <button
              type="button"
              onClick={() => setDraft(null)}
              className={cn(
                "rounded-full border border-line px-5 py-2 text-sm font-semibold transition hover:border-rose active:scale-95",
              )}
            >
              Cancel
            </button>
          </div>
          </div>
        </div>
      )}
    </div>
  );
}
