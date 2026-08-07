"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { Button } from "@/components/ui/Button";
import { compactInputClass } from "@/lib/ui";

type Address = {
  id: string;
  label: string | null;
  line1: string;
  unit: string | null;
  postal_code: string;
};

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
          className={compactInputClass}
          placeholder="Label (e.g. Home)"
          aria-label="Label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <input
          className={compactInputClass}
          placeholder="Postal code"
          aria-label="Postal code"
          value={postal}
          onChange={(e) => setPostal(e.target.value)}
          inputMode="numeric"
        />
        <input
          className={`${compactInputClass} sm:col-span-2`}
          placeholder="Block & street"
          aria-label="Block and street"
          value={line1}
          onChange={(e) => setLine1(e.target.value)}
        />
        <input
          className={compactInputClass}
          placeholder="Unit (optional)"
          aria-label="Unit (optional)"
          value={unit}
          onChange={(e) => setUnit(e.target.value)}
        />
        <Button type="button" size="sm" onClick={add}>
          Add address
        </Button>
      </div>
      {error && <p className="mt-2 text-sm text-rose-ink">{error}</p>}
    </div>
  );
}
