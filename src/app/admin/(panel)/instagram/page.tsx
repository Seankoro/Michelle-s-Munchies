"use client";

import { useEffect, useState, type ChangeEvent } from "react";
import { AdminModal } from "@/components/admin/AdminModal";
import {
  loadInstagramPostsAction,
  createInstagramPostAction,
  updateInstagramPostAction,
  deleteInstagramPostAction,
  uploadProductImageAction,
} from "@/lib/admin-actions";
import type { AdminInstagramPost } from "@/lib/admin-content";
import { compactInputClass as inputClass } from "@/lib/ui";
import { Toggle } from "@/components/ui/Toggle";
import { PanelLoading } from "@/components/admin/PanelLoading";

type Draft = {
  id: string | null;
  imageUrl: string;
  linkUrl: string;
  caption: string;
  isActive: boolean;
  sortOrder: number;
};

const emptyDraft: Draft = {
  id: null,
  imageUrl: "",
  linkUrl: "",
  caption: "",
  isActive: true,
  sortOrder: 0,
};

export default function AdminInstagramPage() {
  const [posts, setPosts] = useState<AdminInstagramPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);

  async function refresh() {
    setLoading(true);
    try {
      setPosts(await loadInstagramPostsAction());
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
  }, []);

  /**
   * The photo is uploaded into our own Supabase bucket rather than linked from
   * Instagram, because the browser only trusts images from Supabase and because
   * Instagram's own image links stop working after a while.
   */
  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ""; // allow re-selecting the same file
    if (!file) return;
    setError("");
    setUploading(true);
    const fd = new FormData();
    fd.append("file", file);
    const result = await uploadProductImageAction(fd);
    setUploading(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setDraft((d) => (d ? { ...d, imageUrl: result.url } : d));
  }

  async function save() {
    if (!draft) return;
    setError("");
    const input = {
      imageUrl: draft.imageUrl.trim(),
      linkUrl: draft.linkUrl.trim(),
      caption: draft.caption.trim() || null,
      isActive: draft.isActive,
      sortOrder: draft.sortOrder,
    };
    if (!input.imageUrl) {
      setError("Add a photo for this post.");
      return;
    }
    const result = draft.id
      ? await updateInstagramPostAction(draft.id, input)
      : await createInstagramPostAction(input);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setDraft(null);
    await refresh();
  }

  async function remove(id: string) {
    if (!window.confirm("Remove this post from the grid?")) return;
    await deleteInstagramPostAction(id);
    await refresh();
  }

  if (loading) return <PanelLoading />;

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-3xl font-semibold">Instagram</h1>
        <button
          type="button"
          onClick={() => {
            setError("");
            setDraft({ ...emptyDraft });
          }}
          className="rounded-full bg-rose-deep px-4 py-2 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:brightness-110 active:scale-95"
        >
          + Add post
        </button>
      </div>
      <p className="mt-1 text-muted">
        Upload the photo and paste the link to the post it should open. We keep our own copy of the
        photo because Instagram&rsquo;s image links stop working after a while.
      </p>

      <ul className="mt-6 flex flex-col gap-3">
        {posts.length === 0 && <p className="text-sm text-muted">No posts yet.</p>}
        {posts.map((p) => (
          <li
            key={p.id}
            className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-white p-3"
          >
            <div className="flex min-w-0 items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.imageUrl} alt={p.caption || "Instagram post"} className="h-12 w-12 shrink-0 rounded-lg object-cover" />
              <span className="truncate text-sm text-muted">
                {p.caption || p.linkUrl} {!p.isActive && "(hidden)"}
              </span>
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                onClick={() =>
                  setDraft({
                    id: p.id,
                    imageUrl: p.imageUrl,
                    linkUrl: p.linkUrl,
                    caption: p.caption ?? "",
                    isActive: p.isActive,
                    sortOrder: p.sortOrder,
                  })
                }
                className="rounded-full border border-line px-3 py-1.5 text-sm font-semibold transition hover:border-rose active:scale-95"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => remove(p.id)}
                className="rounded-full border border-line px-3 py-1.5 text-sm font-semibold text-rose-ink transition hover:border-rose active:scale-95"
              >
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>

      {draft && (
        <AdminModal
          onClose={() => setDraft(null)}
          ariaLabel={draft.id ? "Edit post" : "New post"}
          title={
            <h2 className="font-display text-lg font-semibold">
              {draft.id ? "Edit post" : "New post"}
            </h2>
          }
        >
          <div>
            <span className="text-sm font-semibold">Photo</span>
            <div className="mt-2 flex items-center gap-3">
              {draft.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={draft.imageUrl}
                  alt="Post photo"
                  className="h-20 w-20 shrink-0 rounded-xl border border-line object-cover"
                />
              )}
              <label
                className={`flex h-20 w-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-blush text-xs font-semibold text-rose-ink${
                  uploading ? " opacity-60" : ""
                }`}
              >
                {uploading ? "Uploading…" : draft.imageUrl ? "Replace" : "+ Add"}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleUpload}
                  disabled={uploading}
                />
              </label>
            </div>
          </div>
          <label className="mt-3 flex flex-col gap-1 text-sm font-semibold">
            Post link
            <input
              className={inputClass}
              value={draft.linkUrl}
              onChange={(e) => setDraft((d) => (d ? { ...d, linkUrl: e.target.value } : d))}
            />
          </label>
          <label className="mt-3 flex flex-col gap-1 text-sm font-semibold">
            Caption (optional)
            <input
              className={inputClass}
              value={draft.caption}
              onChange={(e) => setDraft((d) => (d ? { ...d, caption: e.target.value } : d))}
            />
          </label>
          <div className="mt-3 flex items-center gap-4">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Toggle
                checked={draft.isActive}
                onChange={(v) => setDraft((d) => (d ? { ...d, isActive: v } : d))}
                label="Active"
              />
              Active
            </div>
            <label className="flex items-center gap-2 text-sm font-semibold">
              Order
              <input
                className={`${inputClass} max-w-20`}
                value={String(draft.sortOrder)}
                inputMode="numeric"
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10);
                  setDraft((d) =>
                    d ? { ...d, sortOrder: Number.isFinite(n) ? Math.max(0, n) : 0 } : d,
                  );
                }}
              />
            </label>
          </div>
          {error && <p className="mt-3 text-sm text-rose-ink">{error}</p>}
          <div className="mt-5 flex gap-3">
            <button
              type="button"
              onClick={save}
              disabled={uploading}
              className="rounded-full bg-rose-deep px-5 py-2 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:brightness-110 active:scale-95 disabled:opacity-60"
            >
              Save post
            </button>
            <button
              type="button"
              onClick={() => setDraft(null)}
              className="rounded-full border border-line px-5 py-2 text-sm font-semibold transition hover:border-rose active:scale-95"
            >
              Cancel
            </button>
          </div>
        </AdminModal>
      )}
    </div>
  );
}
