"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { updateProfile } from "@/app/account/actions";
import { useFeatures } from "@/components/features/FeaturesProvider";
import { dietaryMeta } from "@/lib/catalog";
import type { DietaryTag } from "@/lib/types";
import { cn } from "@/lib/cn";
import { inputClass } from "@/lib/ui";

const ALL_DIETARY = Object.keys(dietaryMeta) as DietaryTag[];

export function ProfileForm({
  email,
  initialName,
  initialPhone,
  initialBirthday = "",
  initialDietaryPrefs = [],
}: {
  email: string;
  initialName: string;
  initialPhone: string;
  initialBirthday?: string;
  initialDietaryPrefs?: string[];
}) {
  const { dietaryPrefs: dietaryPrefsEnabled } = useFeatures();
  const [fullName, setFullName] = useState(initialName);
  const [phone, setPhone] = useState(initialPhone);
  const [birthday, setBirthday] = useState(initialBirthday);
  const [dietaryPrefs, setDietaryPrefs] = useState<string[]>(initialDietaryPrefs);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  function toggleDiet(tag: string) {
    setDietaryPrefs((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  }

  async function handleSave() {
    setSaved(false);
    setError("");
    setSaving(true);
    const result = await updateProfile(fullName, phone, birthday || null, dietaryPrefs);
    setSaving(false);
    if (result.error) setError(result.error);
    else {
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        handleSave();
      }}
      className="flex flex-col gap-4"
    >
      <div>
        <label className="mb-1 block text-sm font-semibold">Email</label>
        <input className={`${inputClass} opacity-70`} value={email} readOnly />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="full_name" className="mb-1 block text-sm font-semibold">Name</label>
          <input
            id="full_name"
            className={inputClass}
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="phone" className="mb-1 block text-sm font-semibold">Phone</label>
          <input
            id="phone"
            className={inputClass}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            inputMode="tel"
          />
        </div>
        <div>
          <label htmlFor="birthday" className="mb-1 block text-sm font-semibold">
            Birthday <span className="font-normal text-muted">(for a birthday treat 🎂)</span>
          </label>
          <input
            id="birthday"
            type="date"
            className={inputClass}
            value={birthday}
            onChange={(e) => setBirthday(e.target.value)}
          />
        </div>
      </div>
      {dietaryPrefsEnabled && (
        <div>
          <span className="mb-1 block text-sm font-semibold">
            Dietary preferences <span className="font-normal text-muted">(we&rsquo;ll tailor your menu)</span>
          </span>
          <div className="flex flex-wrap gap-2">
            {ALL_DIETARY.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => toggleDiet(tag)}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-xs font-semibold transition",
                  dietaryPrefs.includes(tag)
                    ? "border-rose-deep bg-blush-soft text-rose-deep"
                    : "border-line bg-white text-ink hover:border-rose",
                )}
              >
                {dietaryMeta[tag].label}
              </button>
            ))}
          </div>
        </div>
      )}
      {error && <p className="text-sm text-rose-deep">{error}</p>}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save profile"}
        </Button>
        {saved && <span className="text-sm font-semibold text-emerald-600">Saved ✓</span>}
      </div>
    </form>
  );
}
