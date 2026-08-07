"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { Button } from "@/components/ui/Button";
import { compactInputClass } from "@/lib/ui";

type Occasion = {
  id: string;
  label: string;
  month: number;
  day: number;
  remind_days_before: number;
};

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const REMIND_CHOICES = [3, 7, 14];

/** Days in a month, ignoring leap years, so the day dropdown never offers the 30th of Feb. */
function daysInMonth(month: number): number {
  return [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 31;
}

/**
 * A signed-in customer's saved occasions (birthdays, anniversaries). We email a
 * reorder nudge a chosen number of days before each one. Writes go straight to
 * the RLS-guarded `occasions` table with the browser client, like saved
 * addresses, so a customer can only ever touch their own rows.
 */
export function SavedOccasions() {
  const supabase = useMemo(() => createBrowserSupabase(), []);
  const [occasions, setOccasions] = useState<Occasion[]>([]);
  const [label, setLabel] = useState("");
  const [month, setMonth] = useState(1);
  const [day, setDay] = useState(1);
  const [remind, setRemind] = useState(7);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("occasions")
      .select("id, label, month, day, remind_days_before")
      .order("month", { ascending: true })
      .order("day", { ascending: true });
    setOccasions((data as Occasion[] | null) ?? []);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  async function add() {
    setError("");
    if (!label.trim()) {
      setError("Give the occasion a name, like Mum's birthday.");
      return;
    }
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const safeDay = Math.min(day, daysInMonth(month));
    const { error: insertError } = await supabase.from("occasions").insert({
      user_id: user.id,
      label: label.trim(),
      month,
      day: safeDay,
      remind_days_before: remind,
    });
    if (insertError) {
      setError(insertError.message);
      return;
    }
    setLabel("");
    setMonth(1);
    setDay(1);
    setRemind(7);
    await load();
  }

  async function remove(id: string) {
    await supabase.from("occasions").delete().eq("id", id);
    await load();
  }

  return (
    <div>
      {occasions.length === 0 ? (
        <p className="text-sm text-muted">
          No reminders yet. Save a birthday and we&rsquo;ll nudge you in time to order.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {occasions.map((occasion) => (
            <li
              key={occasion.id}
              className="flex items-start justify-between gap-3 rounded-xl border border-line bg-white p-3 text-sm"
            >
              <span>
                <span className="font-semibold">{occasion.label}</span>
                <span className="text-muted">
                  {" "}
                  · {MONTHS[occasion.month - 1]} {occasion.day} · remind{" "}
                  {occasion.remind_days_before} days before
                </span>
              </span>
              <button
                type="button"
                onClick={() => remove(occasion.id)}
                className="shrink-0 text-xs font-semibold text-muted transition hover:text-rose-ink"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <input
          className={`${compactInputClass} sm:col-span-2`}
          placeholder="Occasion (e.g. Mum's birthday)"
          aria-label="Occasion"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <select
          className={compactInputClass}
          value={month}
          onChange={(e) => setMonth(Number(e.target.value))}
          aria-label="Month"
        >
          {MONTHS.map((name, index) => (
            <option key={name} value={index + 1}>
              {name}
            </option>
          ))}
        </select>
        <select
          className={compactInputClass}
          value={day}
          onChange={(e) => setDay(Number(e.target.value))}
          aria-label="Day"
        >
          {Array.from({ length: daysInMonth(month) }, (_, i) => i + 1).map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <select
          className={compactInputClass}
          value={remind}
          onChange={(e) => setRemind(Number(e.target.value))}
          aria-label="Remind me before"
        >
          {REMIND_CHOICES.map((days) => (
            <option key={days} value={days}>
              Remind {days} days before
            </option>
          ))}
        </select>
        <Button type="button" size="sm" onClick={add}>
          Add reminder
        </Button>
      </div>
      {error && <p className="mt-2 text-sm text-rose-ink">{error}</p>}
    </div>
  );
}
