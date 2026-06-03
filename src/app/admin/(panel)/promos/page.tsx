"use client";

import { useEffect, useState } from "react";
import {
  createPromoAction,
  deletePromoAction,
  loadPromosAction,
  setPromoActiveAction,
} from "@/lib/admin-actions";
import type { PromoCode } from "@/lib/admin-db";
import { formatPrice } from "@/lib/catalog";
import { formatLongDate } from "@/lib/order";
import { cn } from "@/lib/cn";
import { Toggle } from "@/components/ui/Toggle";
import { compactInputClass as inputClass } from "@/lib/ui";

type DiscountType = "percent" | "amount" | "free_delivery";

export default function AdminPromosPage() {
  const [promos, setPromos] = useState<PromoCode[]>([]);
  const [loading, setLoading] = useState(true);

  // Create form
  const [code, setCode] = useState("");
  const [discountType, setDiscountType] = useState<DiscountType>("percent");
  const [value, setValue] = useState("10");
  const [minOrder, setMinOrder] = useState("0.00");
  const [expiry, setExpiry] = useState("");
  const [maxRedemptions, setMaxRedemptions] = useState("");
  const [perCustomerLimit, setPerCustomerLimit] = useState("");
  const [firstOrderOnly, setFirstOrderOnly] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    loadPromosAction()
      .then(setPromos)
      .catch(() => setFormError("Couldn’t load promo codes."))
      .finally(() => setLoading(false));
  }, []);

  function parseLimit(text: string): number | null {
    const n = parseInt(text.trim(), 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  async function handleCreate() {
    setFormError(null);
    setCreating(true);
    const discountValue =
      discountType === "percent"
        ? Math.round(parseFloat(value || "0"))
        : discountType === "amount"
          ? Math.max(0, Math.round(parseFloat(value || "0") * 100))
          : 0; // free_delivery
    const result = await createPromoAction({
      code,
      discountType,
      discountValue,
      minOrderCents: Math.max(0, Math.round(parseFloat(minOrder || "0") * 100)),
      expiresAt: expiry || null,
      maxRedemptions: parseLimit(maxRedemptions),
      perCustomerLimit: parseLimit(perCustomerLimit),
      firstOrderOnly,
    });
    setCreating(false);
    if (!result.ok) {
      setFormError(result.error);
      return;
    }
    setPromos((prev) => [result.promo, ...prev]);
    setCode("");
    setValue(discountType === "percent" ? "10" : "5.00");
    setMinOrder("0.00");
    setExpiry("");
    setMaxRedemptions("");
    setPerCustomerLimit("");
    setFirstOrderOnly(false);
  }

  async function toggleActive(promo: PromoCode) {
    setBusyId(promo.id);
    await setPromoActiveAction(promo.id, !promo.active);
    setPromos((prev) =>
      prev.map((p) => (p.id === promo.id ? { ...p, active: !p.active } : p)),
    );
    setBusyId(null);
  }

  async function remove(promo: PromoCode) {
    if (!window.confirm(`Delete code ${promo.code}? This can’t be undone.`)) return;
    setBusyId(promo.id);
    await deletePromoAction(promo.id);
    setPromos((prev) => prev.filter((p) => p.id !== promo.id));
    setBusyId(null);
  }

  function describe(promo: PromoCode) {
    if (promo.discountType === "percent") return `${promo.discountValue}% off`;
    if (promo.discountType === "amount") return `${formatPrice(promo.discountValue)} off`;
    return "Free delivery";
  }

  return (
    <div className="max-w-3xl">
      <h1 className="font-display text-3xl font-semibold">Promo codes</h1>
      <p className="mt-1 text-muted">Create discount codes customers can apply at checkout.</p>

      {/* Create */}
      <section className="mt-6 rounded-2xl border border-line bg-white p-5">
        <h2 className="font-display text-lg font-semibold">New code</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm font-semibold">
            Code
            <input
              className={cn(inputClass, "uppercase")}
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="SWEET10"
              maxLength={20}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold">
            Discount type
            <select
              className={inputClass}
              value={discountType}
              onChange={(e) => {
                const next = e.target.value as DiscountType;
                setDiscountType(next);
                if (next === "percent") setValue("10");
                else if (next === "amount") setValue("5.00");
              }}
            >
              <option value="percent">Percent off</option>
              <option value="amount">Fixed amount off</option>
              <option value="free_delivery">Free delivery</option>
            </select>
          </label>
          {discountType !== "free_delivery" && (
            <label className="flex flex-col gap-1 text-sm font-semibold">
              {discountType === "percent" ? "Percent (1–100)" : "Amount (S$)"}
              <input
                className={inputClass}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                inputMode="decimal"
              />
            </label>
          )}
          <label className="flex flex-col gap-1 text-sm font-semibold">
            Minimum order (S$)
            <input
              className={inputClass}
              value={minOrder}
              onChange={(e) => setMinOrder(e.target.value)}
              inputMode="decimal"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold">
            Expires (optional)
            <input
              type="date"
              className={inputClass}
              value={expiry}
              onChange={(e) => setExpiry(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold">
            Max total uses (optional)
            <input
              className={inputClass}
              value={maxRedemptions}
              onChange={(e) => setMaxRedemptions(e.target.value)}
              inputMode="numeric"
              placeholder="Unlimited"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold">
            Max uses per customer (optional)
            <input
              className={inputClass}
              value={perCustomerLimit}
              onChange={(e) => setPerCustomerLimit(e.target.value)}
              inputMode="numeric"
              placeholder="Unlimited"
            />
          </label>
          <div className="flex items-center gap-2 text-sm font-semibold sm:col-span-2">
            <Toggle
              checked={firstOrderOnly}
              onChange={setFirstOrderOnly}
              label="First order only"
            />
            First order only (requires sign-in)
          </div>
        </div>
        {formError && <p className="mt-3 text-sm font-semibold text-red-600">{formError}</p>}
        <button
          type="button"
          onClick={handleCreate}
          disabled={creating}
          className="mt-4 rounded-full bg-rose-deep px-6 py-2.5 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:brightness-110 active:scale-95 disabled:opacity-60"
        >
          {creating ? "Creating…" : "Create code"}
        </button>
      </section>

      {/* List */}
      <section className="mt-6">
        <h2 className="font-display text-lg font-semibold">Your codes</h2>
        {loading ? (
          null
        ) : promos.length === 0 ? (
          <p className="mt-3 text-muted">No codes yet. Create one above.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {promos.map((promo) => {
              const expired =
                promo.expiresAt !== null &&
                promo.expiresAt < new Date().toISOString().slice(0, 10);
              return (
                <li
                  key={promo.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-white p-4"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-display text-lg font-semibold tracking-wide">
                        {promo.code}
                      </span>
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-xs font-semibold",
                          promo.active && !expired
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-stone-100 text-stone-500",
                        )}
                      >
                        {expired ? "Expired" : promo.active ? "Active" : "Paused"}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-muted">
                      {describe(promo)}
                      {promo.minOrderCents > 0 && (
                        <> · min {formatPrice(promo.minOrderCents)}</>
                      )}
                      {" · "}used {promo.redemptions}
                      {promo.maxRedemptions != null && <>/{promo.maxRedemptions}</>}
                      {promo.perCustomerLimit != null && (
                        <> · {promo.perCustomerLimit}/customer</>
                      )}
                      {promo.firstOrderOnly && <> · first order only</>}
                      {promo.expiresAt && <> · expires {formatLongDate(promo.expiresAt)}</>}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => toggleActive(promo)}
                      disabled={busyId === promo.id}
                      className="rounded-full border border-line px-4 py-2 text-sm font-semibold transition hover:border-rose active:scale-95 disabled:opacity-60"
                    >
                      {promo.active ? "Pause" : "Activate"}
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(promo)}
                      disabled={busyId === promo.id}
                      className="rounded-full border border-line px-4 py-2 text-sm font-semibold text-red-600 transition hover:border-red-300 active:scale-95 disabled:opacity-60"
                    >
                      Delete
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
