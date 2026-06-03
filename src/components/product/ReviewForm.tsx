"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Button } from "@/components/ui/Button";
import { submitReview, uploadReviewImageAction } from "@/lib/review-actions";
import { useFeatures } from "@/components/features/FeaturesProvider";
import { cn } from "@/lib/cn";

export function ReviewForm({
  slug,
  productId,
  initialRating,
  initialBody,
}: {
  slug: string;
  productId: string;
  initialRating: number;
  initialBody: string;
}) {
  const router = useRouter();
  const features = useFeatures();
  const [rating, setRating] = useState(initialRating);
  const [hover, setHover] = useState(0);
  const [body, setBody] = useState(initialBody);
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleUpload(file: File) {
    setError("");
    setUploading(true);
    const data = new FormData();
    data.set("file", file);
    const result = await uploadReviewImageAction(data);
    setUploading(false);
    if (result.ok) setImageUrls((prev) => [...prev, result.url]);
    else setError(result.error);
  }

  async function handleSubmit() {
    if (rating < 1) {
      setError("Please pick a star rating.");
      return;
    }
    setError("");
    setSaved(false);
    setSubmitting(true);
    const result = await submitReview(slug, productId, rating, body, imageUrls);
    setSubmitting(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setSaved(true);
    router.refresh();
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        handleSubmit();
      }}
      className="rounded-2xl border border-line bg-white p-4"
    >
      <p className="text-sm font-semibold text-ink">
        {initialRating > 0 ? "Update your review" : "Leave a review"}
      </p>
      <div className="mt-2 flex items-center gap-1" role="radiogroup" aria-label="Rating">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            aria-label={`${star} star${star === 1 ? "" : "s"}`}
            aria-pressed={rating === star}
            onClick={() => setRating(star)}
            onMouseEnter={() => setHover(star)}
            onMouseLeave={() => setHover(0)}
            className={cn(
              "text-2xl leading-none transition",
              (hover || rating) >= star ? "text-rose-deep" : "text-line",
            )}
          >
            ★
          </button>
        ))}
      </div>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="How was it? (optional)"
        className="mt-3 min-h-20 w-full resize-y rounded-xl border border-line bg-white px-3 py-2 text-sm outline-none transition focus:border-rose"
      />
      {features.photoReviews && (
        <div className="mt-3">
          <div className="flex flex-wrap items-center gap-2">
            {imageUrls.map((url) => (
              <div key={url} className="relative h-14 w-14 overflow-hidden rounded-lg">
                <Image src={url} alt="Review photo" fill sizes="56px" className="object-cover" />
                <button
                  type="button"
                  aria-label="Remove photo"
                  onClick={() => setImageUrls((prev) => prev.filter((u) => u !== url))}
                  className="absolute right-0 top-0 bg-white/90 px-1 text-xs text-rose-deep"
                >
                  ✕
                </button>
              </div>
            ))}
            <label className="flex h-14 w-14 cursor-pointer items-center justify-center rounded-lg border border-dashed border-line text-lg text-muted hover:border-rose">
              {uploading ? "…" : "+"}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleUpload(file);
                  e.target.value = "";
                }}
              />
            </label>
          </div>
          <p className="mt-1 text-xs text-muted">Add a photo (optional)</p>
        </div>
      )}
      {error && <p className="mt-2 text-sm text-rose-deep">{error}</p>}
      <div className="mt-3 flex items-center gap-3">
        <Button type="submit" size="sm" disabled={submitting || uploading}>
          {submitting ? "Saving…" : initialRating > 0 ? "Update review" : "Post review"}
        </Button>
        {saved && <span className="text-sm font-semibold text-emerald-600">Thanks! ✓</span>}
      </div>
    </form>
  );
}
