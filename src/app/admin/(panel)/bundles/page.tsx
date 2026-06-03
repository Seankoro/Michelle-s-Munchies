"use client";

import { useEffect, useRef, useState } from "react";
import { useDialog } from "@/lib/useDialog";
import { useAdmin } from "@/components/admin/AdminStore";
import {
  loadBundlesAction,
  createBundleAction,
  updateBundleAction,
  deleteBundleAction,
} from "@/lib/admin-actions";
import type { AdminBundle } from "@/lib/admin-merch";
import { formatPrice } from "@/lib/catalog";
import { cn } from "@/lib/cn";
import { Toggle } from "@/components/ui/Toggle";
import { slugify } from "@/lib/text";
import { compactInputClass as inputClass } from "@/lib/ui";

type DraftItem = { productId: string; quantity: number };
type Draft = {
  id: string | null;
  name: string;
  slug: string;
  description: string;
  priceStr: string;
  imageUrl: string;
  isActive: boolean;
  sortOrder: number;
  items: DraftItem[];
};


const emptyDraft: Draft = {
  id: null,
  name: "",
  slug: "",
  description: "",
  priceStr: "0.00",
  imageUrl: "",
  isActive: true,
  sortOrder: 0,
  items: [],
};

export default function AdminBundlesPage() {
  const { products, hydrated } = useAdmin();
  const [bundles, setBundles] = useState<AdminBundle[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  useDialog(!!draft, () => setDraft(null), editorRef);
  const [error, setError] = useState("");

  async function refresh() {
    setLoading(true);
    try {
      setBundles(await loadBundlesAction());
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
  }, []);

  function startCreate() {
    setError("");
    setDraft({ ...emptyDraft });
  }
  function startEdit(b: AdminBundle) {
    setError("");
    setDraft({
      id: b.id,
      name: b.name,
      slug: b.slug,
      description: b.description ?? "",
      priceStr: (b.priceCents / 100).toFixed(2),
      imageUrl: b.imageUrl ?? "",
      isActive: b.isActive,
      sortOrder: b.sortOrder,
      items: b.items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
    });
  }

  async function save() {
    if (!draft) return;
    setError("");
    const input = {
      name: draft.name.trim(),
      slug: draft.slug.trim() || slugify(draft.name),
      description: draft.description.trim() || null,
      priceCents: Math.max(0, Math.round(parseFloat(draft.priceStr || "0") * 100)),
      imageUrl: draft.imageUrl.trim() || null,
      isActive: draft.isActive,
      sortOrder: draft.sortOrder,
      items: draft.items.filter((i) => i.productId),
    };
    const result = draft.id
      ? await updateBundleAction(draft.id, input)
      : await createBundleAction(input);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setDraft(null);
    await refresh();
  }

  async function remove(id: string) {
    await deleteBundleAction(id);
    await refresh();
  }

  if (!hydrated || loading) return null;

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-3xl font-semibold">Bundles</h1>
        <button
          type="button"
          onClick={startCreate}
          className="rounded-full bg-rose-deep px-4 py-2 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:brightness-110 active:scale-95"
        >
          + New bundle
        </button>
      </div>
      <p className="mt-1 text-muted">Curated sets sold as one item.</p>

      <ul className="mt-6 flex flex-col gap-3">
        {bundles.length === 0 && <p className="text-sm text-muted">No bundles yet.</p>}
        {bundles.map((b) => (
          <li
            key={b.id}
            className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-white p-4"
          >
            <div>
              <p className="font-semibold">
                {b.name}{" "}
                {!b.isActive && <span className="text-xs text-muted">(hidden)</span>}
              </p>
              <p className="text-sm text-muted">
                {formatPrice(b.priceCents)} · {b.items.length} item{b.items.length === 1 ? "" : "s"}
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
          aria-label={draft.id ? "Edit bundle" : "New bundle"}
          onClick={() => setDraft(null)}
          className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 sm:items-center sm:p-4"
        >
          <div
            ref={editorRef}
            onClick={(e) => e.stopPropagation()}
            className="max-h-[90vh] w-full max-w-lg animate-[fade-up_0.2s_ease-out] overflow-y-auto rounded-t-2xl bg-white p-6 shadow-soft sm:rounded-2xl"
          >
            <div className="mb-2 flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold">
                {draft.id ? "Edit bundle" : "New bundle"}
              </h2>
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
              Price (S$)
              <input
                className={inputClass}
                value={draft.priceStr}
                inputMode="decimal"
                onChange={(e) => setDraft((d) => (d ? { ...d, priceStr: e.target.value } : d))}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Sort order
              <input
                className={inputClass}
                value={String(draft.sortOrder)}
                inputMode="numeric"
                onChange={(e) =>
                  setDraft((d) => (d ? { ...d, sortOrder: parseInt(e.target.value || "0", 10) } : d))
                }
              />
            </label>
          </div>
          <label className="mt-4 flex flex-col gap-1 text-sm font-semibold">
            Description
            <textarea
              className={cn(inputClass, "min-h-20 resize-y")}
              value={draft.description}
              onChange={(e) => setDraft((d) => (d ? { ...d, description: e.target.value } : d))}
            />
          </label>
          <div className="mt-4 flex items-center gap-2 text-sm font-semibold">
            <Toggle
              checked={draft.isActive}
              onChange={(v) => setDraft((d) => (d ? { ...d, isActive: v } : d))}
              label="Active on the storefront"
            />
            Active (shown on the storefront)
          </div>

          <h3 className="mt-5 text-sm font-semibold text-ink">Items</h3>
          <div className="mt-2 flex flex-col gap-2">
            {draft.items.map((item, index) => (
              <div key={index} className="flex gap-2">
                <select
                  className={inputClass}
                  value={item.productId}
                  onChange={(e) =>
                    setDraft((d) => {
                      if (!d) return d;
                      const items = [...d.items];
                      items[index] = { ...items[index], productId: e.target.value };
                      return { ...d, items };
                    })
                  }
                >
                  <option value="">Choose a product…</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <input
                  className={cn(inputClass, "max-w-20")}
                  value={String(item.quantity)}
                  inputMode="numeric"
                  onChange={(e) =>
                    setDraft((d) => {
                      if (!d) return d;
                      const items = [...d.items];
                      items[index] = {
                        ...items[index],
                        quantity: Math.max(1, parseInt(e.target.value || "1", 10)),
                      };
                      return { ...d, items };
                    })
                  }
                />
                <button
                  type="button"
                  aria-label="Remove item"
                  onClick={() =>
                    setDraft((d) => (d ? { ...d, items: d.items.filter((_, i) => i !== index) } : d))
                  }
                  className="rounded-full border border-line px-3 text-sm text-rose-deep transition hover:border-rose active:scale-90"
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() =>
                setDraft((d) => (d ? { ...d, items: [...d.items, { productId: "", quantity: 1 }] } : d))
              }
              className="self-start rounded-full border border-line px-3 py-1.5 text-sm font-semibold transition hover:border-rose active:scale-95"
            >
              + Add item
            </button>
          </div>

          {error && <p className="mt-3 text-sm text-rose-deep">{error}</p>}
          <div className="mt-5 flex gap-3">
            <button
              type="button"
              onClick={save}
              className="rounded-full bg-rose-deep px-5 py-2 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:brightness-110 active:scale-95"
            >
              Save bundle
            </button>
            <button
              type="button"
              onClick={() => setDraft(null)}
              className="rounded-full border border-line px-5 py-2 text-sm font-semibold transition hover:border-rose active:scale-95"
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
