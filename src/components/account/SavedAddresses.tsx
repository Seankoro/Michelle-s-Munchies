"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase/browser";

type Address = {
  id: string;
  label: string | null;
  line1: string;
  unit: string | null;
  postal_code: string;
};

const inputClass =
  "w-full rounded-xl border border-line bg-white px-3 py-2 text-sm outline-none transition focus:border-rose";

export function SavedAddresses() {
  const supabase = useMemo(() => createBrowserSupabase(), []);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [label, setLabel] = useState("");
  const [line1, setLine1] = useState("");
  const [unit, setUnit] = useState("");
  const [postal, setPostal] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("addresses")
      .select("id, label, line1, unit, postal_code")
      .order("created_at", { ascending: true });
    setAddresses((data as Address[] | null) ?? []);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  async function add() {
    setError("");
    if (!line1.trim() || !/^\d{6}$/.test(postal)) {
      setError("Enter an address and a 6-digit postal code.");
      return;
    }
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const { error: insertError } = await supabase.from("addresses").insert({
      user_id: user.id,
      label: label.trim() || null,
      line1: line1.trim(),
      unit: unit.trim() || null,
      postal_code: postal,
    });
    if (insertError) {
      setError(insertError.message);
      return;
    }
    setLabel("");
    setLine1("");
    setUnit("");
    setPostal("");
    await load();
  }

  async function remove(id: string) {
    await supabase.from("addresses").delete().eq("id", id);
    await load();
  }

  return (
    <div>
      {addresses.length === 0 ? (
        <p className="text-sm text-muted">No saved addresses yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {addresses.map((address) => (
            <li
              key={address.id}
              className="flex items-start justify-between gap-3 rounded-xl border border-line bg-white p-3 text-sm"
            >
              <span>
                {address.label && <span className="font-semibold">{address.label}: </span>}
                {address.line1}
                {address.unit ? `, ${address.unit}` : ""}, Singapore {address.postal_code}
              </span>
              <button
                type="button"
                onClick={() => remove(address.id)}
                className="shrink-0 text-xs font-semibold text-muted transition hover:text-rose-deep"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <input
          className={inputClass}
          placeholder="Label (e.g. Home)"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <input
          className={inputClass}
          placeholder="Postal code"
          value={postal}
          onChange={(e) => setPostal(e.target.value)}
          inputMode="numeric"
        />
        <input
          className={`${inputClass} sm:col-span-2`}
          placeholder="Block & street"
          value={line1}
          onChange={(e) => setLine1(e.target.value)}
        />
        <input
          className={inputClass}
          placeholder="Unit (optional)"
          value={unit}
          onChange={(e) => setUnit(e.target.value)}
        />
        <button
          type="button"
          onClick={add}
          className="rounded-full bg-rose-deep px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110"
        >
          Add address
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-rose-deep">{error}</p>}
    </div>
  );
}
