"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useCart } from "@/components/cart/CartContext";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { formatPrice, mockSettings } from "@/lib/catalog";
import {
  computeDeliveryFeeCents,
  earliestFulfillmentDate,
  formatLongDate,
  type FulfillmentType,
} from "@/lib/order";
import { applyPromo, placeOrder, recordCheckoutIntentAction } from "./actions";
import { subscribeNewsletterAction } from "@/lib/newsletter-actions";
import type { StoreSettings } from "@/lib/settings";
import { fetchClientSettingsRow } from "@/lib/client-settings";
import { singaporeNow } from "@/lib/time";
import { isValidSgPhone, normalizeSgPhone } from "@/lib/phone";
import { useFeatures } from "@/components/features/FeaturesProvider";
import { CutoffBanner } from "@/components/checkout/CutoffBanner";
import { buttonClasses } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { Toggle } from "@/components/ui/Toggle";
import { inputClass } from "@/lib/ui";

function Field({
  label,
  htmlFor,
  error,
  children,
  optional,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  children: ReactNode;
  optional?: boolean;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1 block text-sm font-semibold text-ink">
        {label}
        {optional && <span className="ml-1 font-normal text-muted">(optional)</span>}
      </label>
      {children}
      {error && <p className="mt-1 text-sm text-rose-deep">{error}</p>}
    </div>
  );
}

export default function CheckoutPage() {
  const { items, subtotalCents, hydrated } = useCart();

  // Live store settings like delivery fee, lead time, windows, blackout, and min order.
  // Seeded with the mock defaults, then replaced with Michelle's saved values.
  const [settings, setSettings] = useState<
    Pick<
      StoreSettings,
      | "deliveryFeeCents"
      | "freeDeliveryMinCents"
      | "minOrderCents"
      | "leadTimeDays"
      | "timeWindows"
      | "blackoutDates"
      | "pickupLocation"
      | "dailyOrderCap"
      | "dailyCutoffTime"
      | "notePrompts"
    >
  >({
    ...mockSettings,
    dailyOrderCap: null,
    dailyCutoffTime: null,
    notePrompts: [],
  });
  const [noteAnswers, setNoteAnswers] = useState<Record<string, string>>({});
  const [newsletterOptIn, setNewsletterOptIn] = useState(false);
  const [dietaryConflicts, setDietaryConflicts] = useState<string[]>([]);
  const features = useFeatures();
  const earliest = useMemo(
    () => earliestFulfillmentDate(settings.leadTimeDays, singaporeNow(), settings.dailyCutoffTime),
    [settings.leadTimeDays, settings.dailyCutoffTime],
  );

  const [fulfillment, setFulfillment] = useState<FulfillmentType>("pickup");
  const [date, setDate] = useState(earliest);
  const [timeWindow, setTimeWindow] = useState(mockSettings.timeWindows[0]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [line1, setLine1] = useState("");
  const [unit, setUnit] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [notes, setNotes] = useState("");
  const [isGift, setIsGift] = useState(false);
  const [giftMessage, setGiftMessage] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [recipientPhone, setRecipientPhone] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const deliveryFeeCents = computeDeliveryFeeCents(subtotalCents, fulfillment, settings);

  // Rewards, load the signed-in customer's points balance if any.
  const [pointsBalance, setPointsBalance] = useState(0);
  const [pointValueCents, setPointValueCents] = useState(5);
  const [applyPoints, setApplyPoints] = useState(false);

  // Promo code
  const [promoInput, setPromoInput] = useState("");
  const [appliedPromo, setAppliedPromo] = useState<
    { code: string; discountCents: number; label: string } | null
  >(null);
  const [promoError, setPromoError] = useState("");
  const [applyingPromo, setApplyingPromo] = useState(false);

  useEffect(() => {
    const supabase = createBrowserSupabase();
    let active = true;
    (async () => {
      // Live store settings, for every shopper, signed in or not.
      const r = await fetchClientSettingsRow();
      if (!active) return;
      if (r) {
        const windows =
          r.time_windows && r.time_windows.length > 0 ? r.time_windows : mockSettings.timeWindows;
        const leadTimeDays = r.lead_time_days ?? mockSettings.leadTimeDays;
        setSettings({
          deliveryFeeCents: r.delivery_fee_cents ?? mockSettings.deliveryFeeCents,
          freeDeliveryMinCents: r.free_delivery_min_cents ?? mockSettings.freeDeliveryMinCents,
          minOrderCents: r.min_order_cents ?? mockSettings.minOrderCents,
          leadTimeDays,
          timeWindows: windows,
          blackoutDates: r.blackout_dates ?? mockSettings.blackoutDates,
          pickupLocation: r.pickup_location_public || mockSettings.pickupLocation,
          dailyOrderCap: r.daily_order_cap,
          dailyCutoffTime: r.daily_cutoff_time,
          notePrompts: Array.isArray(r.note_prompts) ? r.note_prompts : [],
        });
        setPointValueCents(r.point_value_cents ?? 5);
        // Keep the chosen date/window valid under the live rules.
        const liveEarliest = earliestFulfillmentDate(leadTimeDays, singaporeNow(), r.daily_cutoff_time);
        setDate((cur) => (cur < liveEarliest ? liveEarliest : cur));
        setTimeWindow((cur) => (windows.includes(cur) ? cur : windows[0]));
      }

      // Rewards balance, signed-in only.
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || !active) return;
      const { data: ledger } = await supabase
        .from("points_ledger")
        .select("delta")
        .eq("user_id", user.id);
      if (!active) return;
      const balance = ((ledger as { delta: number }[] | null) ?? []).reduce(
        (sum, e) => sum + e.delta,
        0,
      );
      setPointsBalance(balance);
    })();
    return () => {
      active = false;
    };
  }, []);

  // Dietary-preference conflicts, warn softly if a cart item doesn't match the
  // signed-in customer's saved preferences.
  useEffect(() => {
    if (!features.dietaryPrefs || items.length === 0) {
      setDietaryConflicts([]);
      return;
    }
    const supabase = createBrowserSupabase();
    let active = true;
    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || !active) return;
      const { data: prof } = await supabase
        .from("profiles")
        .select("dietary_prefs")
        .eq("id", user.id)
        .maybeSingle();
      const prefs = (prof as { dietary_prefs: string[] | null } | null)?.dietary_prefs ?? [];
      if (prefs.length === 0) {
        if (active) setDietaryConflicts([]);
        return;
      }
      const productIds = [
        ...new Set(items.map((i) => i.productId).filter((id) => /^[0-9a-f-]{36}$/i.test(id))),
      ];
      if (productIds.length === 0) return;
      const { data: prods } = await supabase
        .from("products")
        .select("id, name, dietary_tags")
        .in("id", productIds);
      if (!active) return;
      const rows = (prods as { id: string; name: string; dietary_tags: string[] | null }[] | null) ?? [];
      const byId = new Map(rows.map((r) => [r.id, r]));
      const conflicts = new Set<string>();
      for (const item of items) {
        const product = byId.get(item.productId);
        if (!product) continue;
        const tags = product.dietary_tags ?? [];
        if (!prefs.every((p) => tags.includes(p))) conflicts.add(product.name);
      }
      setDietaryConflicts([...conflicts]);
    })();
    return () => {
      active = false;
    };
  }, [features.dietaryPrefs, items]);

  // Abandoned-cart capture, shortly after a valid email is entered, record the
  // cart so the cron job can send a reminder if checkout isn't completed.
  useEffect(() => {
    if (!features.abandonedCart || items.length === 0) return;
    const trimmed = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return;
    const id = window.setTimeout(() => {
      void recordCheckoutIntentAction(
        trimmed,
        items.map((i) => ({ name: i.name, quantity: i.quantity })),
        subtotalCents,
      );
    }, 1500);
    return () => window.clearTimeout(id);
  }, [email, items, subtotalCents, features.abandonedCart]);

  // Discount preview, mirrors the server. Promo first, then points fill the
  // remaining room. Keep >= S$0.50 chargeable and snap points to whole points.
  const maxDiscountCents = Math.max(0, subtotalCents + deliveryFeeCents - 50);
  const promoDiscountCents = appliedPromo
    ? Math.min(appliedPromo.discountCents, maxDiscountCents)
    : 0;
  const roomAfterPromo = maxDiscountCents - promoDiscountCents;
  const pointsDiscountCents =
    applyPoints && pointsBalance > 0
      ? Math.floor(Math.min(pointsBalance * pointValueCents, roomAfterPromo) / pointValueCents) *
        pointValueCents
      : 0;
  const totalCents = subtotalCents + deliveryFeeCents - promoDiscountCents - pointsDiscountCents;

  async function handleApplyPromo() {
    setPromoError("");
    if (!promoInput.trim()) return;
    setApplyingPromo(true);
    const result = await applyPromo(promoInput, subtotalCents, deliveryFeeCents);
    setApplyingPromo(false);
    if (result.ok) {
      setAppliedPromo({
        code: result.code,
        discountCents: result.discountCents,
        label: result.label,
      });
    } else {
      setAppliedPromo(null);
      setPromoError(result.error);
    }
  }

  // Re-validate the applied promo whenever the subtotal or delivery fee changes,
  // so the preview stays correct, like a free-delivery code as fulfillment toggles.
  const appliedCode = appliedPromo?.code;
  useEffect(() => {
    if (!appliedCode) return;
    let active = true;
    void (async () => {
      const result = await applyPromo(appliedCode, subtotalCents, deliveryFeeCents);
      if (!active) return;
      if (result.ok) {
        setAppliedPromo({
          code: result.code,
          discountCents: result.discountCents,
          label: result.label,
        });
      } else {
        setAppliedPromo(null);
        setPromoError(result.error);
      }
    })();
    return () => {
      active = false;
    };
  }, [appliedCode, subtotalCents, deliveryFeeCents]);

  if (!hydrated) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-16 text-center text-muted">Loading…</main>
    );
  }

  if (items.length === 0) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-20 text-center">
        <p className="text-5xl" aria-hidden="true">🎀</p>
        <h1 className="mt-4 font-display text-3xl font-semibold">Your cart is empty</h1>
        <p className="mt-2 text-muted">Add a treat or two before checking out.</p>
        <Link href="/menu" className={buttonClasses({ className: "mt-8", size: "lg" })}>
          Browse the menu
        </Link>
      </main>
    );
  }

  function validate(): Record<string, string> {
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = "Please tell us your name.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) next.email = "Enter a valid email.";
    if (!isValidSgPhone(phone)) next.phone = "Enter a Singapore mobile number, e.g. 9123 4567.";
    if (!date) next.date = "Pick a date.";
    else if (date < earliest)
      next.date = `Earliest available is ${formatLongDate(earliest)} (we bake to order).`;
    else if (settings.blackoutDates.includes(date))
      next.date = "We're away that day. Please choose another date.";
    if (!timeWindow) next.timeWindow = "Pick a time window.";
    if (fulfillment === "delivery") {
      if (!line1.trim()) next.line1 = "Delivery address is required.";
      if (!/^\d{6}$/.test(postalCode)) next.postalCode = "Enter a 6-digit Singapore postal code.";
    }
    if (isGift && !recipientName.trim()) next.recipientName = "Who’s this gift for?";
    if (isGift && recipientPhone.trim() && !isValidSgPhone(recipientPhone))
      next.recipientPhone = "Enter a Singapore mobile number, e.g. 9123 4567.";
    if (subtotalCents < settings.minOrderCents) {
      next.order = `Minimum order is ${formatPrice(settings.minOrderCents)}.`;
    }
    return next;
  }

  async function handleSubmit() {
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) {
      // Move focus to the first error for usability.
      const firstId = Object.keys(found)[0];
      document.getElementById(firstId)?.focus();
      return;
    }

    setSubmitting(true);

    // Persist the order via a Server Action, where amounts are recomputed server-side.
    // Payment is arranged later over WhatsApp, or via Stripe if it is ever configured.
    const result = await placeOrder(
      {
        items,
        fulfillmentType: fulfillment,
        scheduledDate: date,
        timeWindow,
        address:
          fulfillment === "delivery"
            ? { line1: line1.trim(), unit: unit.trim() || undefined, postalCode }
            : undefined,
        name: name.trim(),
        email: email.trim(),
        phone: normalizeSgPhone(phone) ?? phone.trim(),
        notes: notes.trim() || undefined,
        isGift,
        giftMessage: isGift ? giftMessage.trim() || undefined : undefined,
        recipientName: isGift ? recipientName.trim() || undefined : undefined,
        recipientPhone: isGift
          ? recipientPhone.trim()
            ? normalizeSgPhone(recipientPhone) ?? recipientPhone.trim()
            : undefined
          : undefined,
        noteAnswers: settings.notePrompts.map((p) => ({
          id: p.id,
          label: p.label,
          answer: (noteAnswers[p.id] ?? "").trim(),
        })),
      },
      applyPoints,
      appliedPromo?.code ?? "",
    );

    if (!result.ok) {
      setErrors({ order: result.error });
      setSubmitting(false);
      return;
    }

    // Newsletter opt-in, best-effort and never blocks the redirect.
    if (newsletterOptIn && features.newsletter) {
      void subscribeNewsletterAction(email.trim());
    }

    // Full navigation handles both the external Stripe Checkout URL and the
    // internal tracking page. The cart is cleared on the tracking page, so a
    // cancelled payment leaves the cart intact for another try.
    window.location.href = result.redirectUrl;
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <h1 className="font-display text-4xl font-semibold">Checkout</h1>
      <p className="mt-2 text-muted">No account needed. Just a few details and you&rsquo;re set.</p>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          handleSubmit();
        }}
        className="mt-8 grid gap-10 lg:grid-cols-[1fr_360px]"
      >
        {/* Left: details */}
        <div className="flex flex-col gap-8">
          {/* Fulfillment */}
          <section>
            <h2 className="font-display text-xl font-semibold">How would you like it?</h2>
            <div className="mt-3 grid grid-cols-2 gap-3">
              {(["pickup", "delivery"] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setFulfillment(type)}
                  aria-pressed={fulfillment === type}
                  className={cn(
                    "rounded-2xl border px-4 py-4 text-left transition",
                    fulfillment === type
                      ? "border-rose-deep bg-blush-soft"
                      : "border-line bg-white hover:border-rose",
                  )}
                >
                  <span className="block font-semibold capitalize text-ink">
                    {type === "pickup" ? "Self-pickup" : "Delivery"}
                  </span>
                  <span className="mt-1 block text-sm text-muted">
                    {type === "pickup"
                      ? "Free · collect from us"
                      : subtotalCents >= settings.freeDeliveryMinCents
                        ? "Free delivery!"
                        : `${formatPrice(settings.deliveryFeeCents)} islandwide`}
                  </span>
                </button>
              ))}
            </div>
            {fulfillment === "pickup" && (
              <p className="mt-3 rounded-xl bg-marble/60 px-4 py-3 text-sm text-muted">
                📍 Pickup: {settings.pickupLocation}
              </p>
            )}
          </section>

          {/* Delivery address */}
          {fulfillment === "delivery" && (
            <section className="flex flex-col gap-4">
              <h2 className="font-display text-xl font-semibold">Delivery address</h2>
              <Field label="Address" htmlFor="line1" error={errors.line1}>
                <input
                  id="line1"
                  className={inputClass}
                  value={line1}
                  onChange={(e) => setLine1(e.target.value)}
                  placeholder="Block & street, e.g. 123 Bedok North Ave 1"
                />
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Unit" htmlFor="unit" optional>
                  <input
                    id="unit"
                    className={inputClass}
                    value={unit}
                    onChange={(e) => setUnit(e.target.value)}
                    placeholder="#12-34"
                  />
                </Field>
                <Field label="Postal code" htmlFor="postalCode" error={errors.postalCode}>
                  <input
                    id="postalCode"
                    className={inputClass}
                    value={postalCode}
                    onChange={(e) => setPostalCode(e.target.value)}
                    inputMode="numeric"
                    placeholder="460123"
                  />
                </Field>
              </div>
            </section>
          )}

          {/* Schedule */}
          <section className="flex flex-col gap-4">
            <h2 className="font-display text-xl font-semibold">When?</h2>
            <p className="-mt-2 text-sm text-muted">
              We bake to order. The earliest date is {formatLongDate(earliest)}.
            </p>
            {settings.dailyCutoffTime && (
              <CutoffBanner
                cutoffTime={settings.dailyCutoffTime}
                earliestLabel={formatLongDate(earliest)}
              />
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Date" htmlFor="date" error={errors.date}>
                <input
                  id="date"
                  type="date"
                  className={inputClass}
                  min={earliest}
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </Field>
              <Field label="Time window" htmlFor="timeWindow" error={errors.timeWindow}>
                <select
                  id="timeWindow"
                  className={inputClass}
                  value={timeWindow}
                  onChange={(e) => setTimeWindow(e.target.value)}
                >
                  {settings.timeWindows.map((window) => (
                    <option key={window} value={window}>
                      {window}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </section>

          {/* Contact */}
          <section className="flex flex-col gap-4">
            <h2 className="font-display text-xl font-semibold">Your details</h2>
            <Field label="Name" htmlFor="name" error={errors.name}>
              <input
                id="name"
                className={inputClass}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Email" htmlFor="email" error={errors.email}>
                <input
                  id="email"
                  type="email"
                  className={inputClass}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </Field>
              <Field label="Phone" htmlFor="phone" error={errors.phone}>
                <input
                  id="phone"
                  type="tel"
                  className={inputClass}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  inputMode="tel"
                />
              </Field>
            </div>
            {features.structuredNotes &&
              settings.notePrompts.map((prompt) => (
                <Field
                  key={prompt.id}
                  label={prompt.label}
                  htmlFor={`note-${prompt.id}`}
                  optional={!prompt.required}
                  error={errors[`note-${prompt.id}`]}
                >
                  {prompt.type === "boolean" ? (
                    <select
                      id={`note-${prompt.id}`}
                      className={inputClass}
                      value={noteAnswers[prompt.id] ?? ""}
                      onChange={(e) =>
                        setNoteAnswers((p) => ({ ...p, [prompt.id]: e.target.value }))
                      }
                    >
                      <option value="">Choose…</option>
                      <option value="Yes">Yes</option>
                      <option value="No">No</option>
                    </select>
                  ) : (
                    <input
                      id={`note-${prompt.id}`}
                      className={inputClass}
                      value={noteAnswers[prompt.id] ?? ""}
                      onChange={(e) =>
                        setNoteAnswers((p) => ({ ...p, [prompt.id]: e.target.value }))
                      }
                    />
                  )}
                </Field>
              ))}
            <Field label="Order notes" htmlFor="notes" optional>
              <textarea
                id="notes"
                className={cn(inputClass, "min-h-20 resize-y")}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Allergies, delivery instructions, a birthday message…"
              />
            </Field>
            {features.newsletter && (
              <div className="flex items-start gap-2 text-sm">
                <Toggle
                  checked={newsletterOptIn}
                  onChange={setNewsletterOptIn}
                  label="Email me occasional updates"
                  className="mt-0.5"
                />
                <span>Email me occasional updates and new treats. Unsubscribe any time.</span>
              </div>
            )}
          </section>

          {/* Gift */}
          {features.gifting && (
          <section className="flex flex-col gap-4">
            <div className="flex items-start gap-3 rounded-2xl border border-line bg-white p-4">
              <Toggle
                checked={isGift}
                onChange={setIsGift}
                label="Send as a gift"
                className="mt-1"
              />
              <span>
                <span className="block font-display text-xl font-semibold text-ink">
                  🎁 Send as a gift
                </span>
                <span className="mt-1 block text-sm text-muted">
                  We&rsquo;ll leave the price off the package and tuck in your message.
                </span>
              </span>
            </div>
            {isGift && (
              <div className="flex flex-col gap-4 rounded-2xl border border-line bg-blush-soft/40 p-4">
                <Field label="Recipient's name" htmlFor="recipientName" error={errors.recipientName}>
                  <input
                    id="recipientName"
                    className={inputClass}
                    value={recipientName}
                    onChange={(e) => setRecipientName(e.target.value)}
                    placeholder="Who&rsquo;s it for?"
                  />
                </Field>
                <Field label="Recipient's phone" htmlFor="recipientPhone" optional error={errors.recipientPhone}>
                  <input
                    id="recipientPhone"
                    type="tel"
                    inputMode="tel"
                    className={inputClass}
                    value={recipientPhone}
                    onChange={(e) => setRecipientPhone(e.target.value)}
                    placeholder="So our courier can reach them on delivery"
                  />
                </Field>
                <Field label="Gift message" htmlFor="giftMessage" optional>
                  <textarea
                    id="giftMessage"
                    className={cn(inputClass, "min-h-20 resize-y")}
                    value={giftMessage}
                    onChange={(e) => setGiftMessage(e.target.value)}
                    maxLength={200}
                    placeholder="Happy birthday! Hope these make your day sweeter 🎂"
                  />
                </Field>
                {fulfillment === "delivery" && (
                  <p className="text-sm text-muted">
                    💌 We&rsquo;ll deliver to the address above, so make sure it&rsquo;s the
                    recipient&rsquo;s.
                  </p>
                )}
              </div>
            )}
          </section>
          )}
        </div>

        {/* Right: summary */}
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-2xl border border-line bg-white p-5">
            <h2 className="font-display text-xl font-semibold">Order summary</h2>
            <ul className="mt-4 flex flex-col gap-3">
              {items.map((item) => (
                <li key={item.key} className="flex justify-between gap-3 text-sm">
                  <span>
                    <span className="font-semibold">{item.quantity}×</span> {item.name}
                    {item.selectedOptions.length > 0 && (
                      <span className="block text-muted">
                        {item.selectedOptions.map((o) => o.valueLabel).join(", ")}
                      </span>
                    )}
                  </span>
                  <span className="font-semibold">
                    {formatPrice(item.unitPriceCents * item.quantity)}
                  </span>
                </li>
              ))}
            </ul>

            {/* Promo code */}
            {features.promos && (
            <div className="mt-4">
              {appliedPromo ? (
                <div className="flex items-center justify-between gap-2 rounded-xl bg-blush-soft/60 p-3 text-sm text-rose-deep">
                  <span>
                    🎟️ <span className="font-semibold">{appliedPromo.code}</span> applied (
                    {appliedPromo.label})
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setAppliedPromo(null);
                      setPromoInput("");
                    }}
                    className="shrink-0 font-semibold underline"
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <input
                    value={promoInput}
                    onChange={(e) => setPromoInput(e.target.value)}
                    placeholder="Promo code"
                    className={cn(inputClass, "py-2 text-sm uppercase")}
                  />
                  <button
                    type="button"
                    onClick={handleApplyPromo}
                    disabled={applyingPromo}
                    className="shrink-0 rounded-xl border border-line px-4 text-sm font-semibold transition hover:border-rose disabled:opacity-60"
                  >
                    {applyingPromo ? "…" : "Apply"}
                  </button>
                </div>
              )}
              {promoError && <p className="mt-1 text-sm text-rose-deep">{promoError}</p>}
            </div>
            )}

            {features.rewards && pointsBalance > 0 && (
              <div className="mt-3 flex items-start gap-3 rounded-xl bg-blush-soft/60 p-3 text-sm text-rose-deep">
                <Toggle
                  checked={applyPoints}
                  onChange={setApplyPoints}
                  label="Use my points"
                  className="mt-0.5"
                />
                <span>
                  🏆 Use my {pointsBalance} {pointsBalance === 1 ? "point" : "points"}
                  {pointsDiscountCents > 0 && <> (−{formatPrice(pointsDiscountCents)})</>}
                </span>
              </div>
            )}

            <hr className="my-4 border-line" />
            <dl className="flex flex-col gap-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted">Subtotal</dt>
                <dd>{formatPrice(subtotalCents)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">{fulfillment === "pickup" ? "Pickup" : "Delivery"}</dt>
                <dd>{deliveryFeeCents === 0 ? "Free" : formatPrice(deliveryFeeCents)}</dd>
              </div>
              {promoDiscountCents > 0 && (
                <div className="flex justify-between text-rose-deep">
                  <dt>Promo ({appliedPromo?.code})</dt>
                  <dd>−{formatPrice(promoDiscountCents)}</dd>
                </div>
              )}
              {pointsDiscountCents > 0 && (
                <div className="flex justify-between text-rose-deep">
                  <dt>Rewards points</dt>
                  <dd>−{formatPrice(pointsDiscountCents)}</dd>
                </div>
              )}
              <div className="flex justify-between text-base font-semibold">
                <dt>Total</dt>
                <dd>{formatPrice(totalCents)}</dd>
              </div>
            </dl>

            <p className="mt-4 rounded-xl bg-marble/60 px-3 py-2 text-xs text-muted">
              No payment is taken here. Place your order, then send it to us on WhatsApp from the next
              page and we will confirm and share PayNow details.
            </p>

            {dietaryConflicts.length > 0 && (
              <p className="mt-2 rounded-xl bg-blush-soft/60 px-3 py-2 text-sm text-rose-deep">
                Heads up: {dietaryConflicts.join(", ")} may not match your saved dietary
                preferences. You can still order if that&rsquo;s fine.
              </p>
            )}

            {errors.order && <p className="mt-2 text-sm text-rose-deep">{errors.order}</p>}

            <button
              type="submit"
              disabled={submitting}
              className={buttonClasses({ size: "lg", className: "mt-4 w-full" })}
            >
              {submitting ? "Placing order…" : `Place order · ${formatPrice(totalCents)}`}
            </button>
            <Link
              href="/cart"
              className="mt-3 block text-center text-sm font-semibold text-rose transition hover:text-rose-deep"
            >
              Back to cart
            </Link>
          </div>
        </aside>
      </form>
    </main>
  );
}
