"use client";

import { useEffect, useMemo, useState } from "react";
import { useAdmin, type AdminSettings } from "@/components/admin/AdminStore";
import type { NotePrompt } from "@/lib/settings";
import type { Product } from "@/lib/types";
import { formatLongDate } from "@/lib/order";
import { cn } from "@/lib/cn";
import { Toggle } from "@/components/ui/Toggle";
import { PanelLoading } from "@/components/admin/PanelLoading";
import { compactInputClass as inputClass } from "@/lib/ui";
import { loadDeliveryConfigAction, saveDeliveryConfigAction } from "@/lib/admin-actions";
import type { DistanceTier } from "@/lib/delivery-fee";

export default function AdminSettingsPage() {
  const { settings, updateSettings, hydrated, products } = useAdmin();
  // Mount the form only once settings have loaded, so its initial field values
  // come from the saved settings, not the pre-hydration defaults.
  if (!hydrated) return <PanelLoading />;
  return <SettingsForm settings={settings} onSave={updateSettings} products={products} />;
}

function SettingsForm({
  settings,
  onSave,
  products,
}: {
  settings: AdminSettings;
  onSave: (patch: Partial<AdminSettings>) => Promise<boolean>;
  products: Product[];
}) {
  const [deliveryFee, setDeliveryFee] = useState((settings.deliveryFeeCents / 100).toFixed(2));
  const [freeMin, setFreeMin] = useState((settings.freeDeliveryMinCents / 100).toFixed(2));
  const [minOrder, setMinOrder] = useState((settings.minOrderCents / 100).toFixed(2));
  const [leadTime, setLeadTime] = useState(String(settings.leadTimeDays));
  const [dailyCap, setDailyCap] = useState(
    settings.dailyOrderCap == null ? "" : String(settings.dailyOrderCap),
  );
  const [pickupLocation, setPickupLocation] = useState(settings.pickupLocation);
  const [windowsText, setWindowsText] = useState(settings.timeWindows.join("\n"));
  const [blackout, setBlackout] = useState<string[]>(settings.blackoutDates);
  const [newBlackout, setNewBlackout] = useState("");
  const [pointsPerDollar, setPointsPerDollar] = useState(String(settings.pointsPerDollar));
  const [pointValue, setPointValue] = useState((settings.pointValueCents / 100).toFixed(2));
  const [referrerPts, setReferrerPts] = useState(String(settings.referralReferrerPoints));
  const [refereePts, setRefereePts] = useState(String(settings.referralRefereePoints));
  const [features, setFeatures] = useState(settings.features);
  const [perWindowCap, setPerWindowCap] = useState(
    settings.perWindowCap == null ? "" : String(settings.perWindowCap),
  );
  const [cutoffTime, setCutoffTime] = useState(settings.dailyCutoffTime ?? "");
  const [giftThreshold, setGiftThreshold] = useState(
    settings.freeGiftThresholdCents == null ? "" : (settings.freeGiftThresholdCents / 100).toFixed(2),
  );
  const [giftProductId, setGiftProductId] = useState(settings.freeGiftProductId ?? "");
  const [birthdayPoints, setBirthdayPoints] = useState(String(settings.birthdayRewardPoints));
  const [abandonedHours, setAbandonedHours] = useState(String(settings.abandonedAfterHours));
  const [lowStock, setLowStock] = useState(
    settings.lowStockThreshold == null ? "" : String(settings.lowStockThreshold),
  );
  const [notePrompts, setNotePrompts] = useState<NotePrompt[]>(settings.notePrompts);
  const [mascotMsgs, setMascotMsgs] = useState<string[]>(settings.mascotMessages);
  const [saved, setSaved] = useState(false);

  function toCents(text: string) {
    const n = parseFloat(text);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.round(n * 100));
  }

  const intOr = (text: string, fallback: number) => {
    const n = parseInt(text, 10);
    return Number.isFinite(n) ? n : fallback;
  };

  const optInt = (text: string) => {
    const n = parseInt(text, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  // The full desired settings from the current form state. Shared by the save
  // handler and the dirty check, so "unsaved changes" can never drift from what
  // Save would actually write.
  const buildPatch = (): AdminSettings => ({
    deliveryFeeCents: toCents(deliveryFee),
    freeDeliveryMinCents: toCents(freeMin),
    minOrderCents: toCents(minOrder),
    leadTimeDays: Math.max(0, intOr(leadTime, 0)),
    dailyOrderCap: optInt(dailyCap),
    perWindowCap: optInt(perWindowCap),
    dailyCutoffTime: cutoffTime || null,
    freeGiftThresholdCents: giftThreshold.trim() ? toCents(giftThreshold) : null,
    freeGiftProductId: giftProductId || null,
    birthdayRewardPoints: Math.max(0, intOr(birthdayPoints, 0)),
    abandonedAfterHours: Math.max(1, intOr(abandonedHours, 4)),
    lowStockThreshold: optInt(lowStock),
    notePrompts,
    mascotMessages: mascotMsgs.map((m) => m.trim()).filter(Boolean),
    pickupLocation,
    timeWindows: windowsText
      .split("\n")
      .map((w) => w.trim())
      .filter(Boolean),
    blackoutDates: blackout,
    pointsPerDollar: Math.max(0, intOr(pointsPerDollar, 0)),
    pointValueCents: toCents(pointValue),
    referralReferrerPoints: Math.max(0, intOr(referrerPts, 0)),
    referralRefereePoints: Math.max(0, intOr(refereePts, 0)),
    features,
  });

  // The saved settings normalised through the same builder, so comparison is
  // apples-to-apples and formatting quirks never read as a false change.
  const baseline = useMemo(
    () =>
      JSON.stringify({
        deliveryFeeCents: settings.deliveryFeeCents,
        freeDeliveryMinCents: settings.freeDeliveryMinCents,
        minOrderCents: settings.minOrderCents,
        leadTimeDays: settings.leadTimeDays,
        dailyOrderCap: settings.dailyOrderCap,
        perWindowCap: settings.perWindowCap,
        dailyCutoffTime: settings.dailyCutoffTime,
        freeGiftThresholdCents: settings.freeGiftThresholdCents,
        freeGiftProductId: settings.freeGiftProductId,
        birthdayRewardPoints: settings.birthdayRewardPoints,
        abandonedAfterHours: settings.abandonedAfterHours,
        lowStockThreshold: settings.lowStockThreshold,
        notePrompts: settings.notePrompts,
        mascotMessages: settings.mascotMessages,
        pickupLocation: settings.pickupLocation,
        timeWindows: settings.timeWindows,
        blackoutDates: settings.blackoutDates,
        pointsPerDollar: settings.pointsPerDollar,
        pointValueCents: settings.pointValueCents,
        referralReferrerPoints: settings.referralReferrerPoints,
        referralRefereePoints: settings.referralRefereePoints,
        features: settings.features,
      }),
    [settings],
  );
  const dirty = JSON.stringify(buildPatch()) !== baseline;

  async function handleSave() {
    // "Saved ✓" only after the write actually reached the server. On failure
    // the store rolls the form state back and shows the shell error banner.
    const ok = await onSave(buildPatch());
    if (!ok) return;
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2000);
  }

  // Warn before a full page unload (tab close, refresh, external link) if there
  // are unsaved edits. In-app sidebar navigation stays free; the sticky bar
  // keeps the pending changes visible instead.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const sections: [string, string][] = [
    ["says", "Michelle says"],
    ["delivery", "Delivery"],
    ["pickup", "Pickup"],
    ["blackout", "Blackout"],
    ["rewards", "Rewards"],
    ["merch", "Merchandising"],
    ["notes", "Order notes"],
    ["features", "Features"],
  ];

  return (
    <div className="max-w-2xl pb-24">
      <h1 className="font-display text-3xl font-semibold">Settings</h1>
      <p className="mt-1 text-muted">Delivery, scheduling, and pickup details.</p>

      {/* Quick jump to a section, so a long form is not all scrolling. */}
      <div className="-mx-6 mt-4 flex gap-2 overflow-x-auto px-6 pb-1 no-scrollbar sm:mx-0 sm:flex-wrap sm:px-0">
        {sections.map(([id, label]) => (
          <a
            key={id}
            href={`#settings-${id}`}
            className="shrink-0 rounded-full border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink transition hover:border-rose"
          >
            {label}
          </a>
        ))}
      </div>

      <div className="mt-6 flex flex-col gap-6">
        <section id="settings-says" className="scroll-mt-24 rounded-2xl border border-line bg-white p-5">
          <h2 className="font-display text-lg font-semibold">Michelle says</h2>
          <p className="mt-1 text-sm font-normal text-muted">
            Lines for the speech bubble next to the mascot on the home page. Add as many as you like.
            The mascot cycles through yours plus a couple of automatic lines, which always stay, so
            adding your own never turns those off.
          </p>
          <div className="mt-3 flex flex-col gap-2">
            {mascotMsgs.map((msg, index) => (
              <div key={index} className="flex items-center gap-2">
                <input
                  className={`${inputClass} flex-1 font-normal`}
                  value={msg}
                  onChange={(e) =>
                    setMascotMsgs((prev) => prev.map((m, i) => (i === index ? e.target.value : m)))
                  }
                  maxLength={140}
                  aria-label={`Mascot message ${index + 1}`}
                  placeholder="e.g. Lava cakes are back this weekend!"
                />
                <button
                  type="button"
                  onClick={() => setMascotMsgs((prev) => prev.filter((_, i) => i !== index))}
                  aria-label="Remove message"
                  className="rounded-full p-2 text-muted transition hover:bg-blush-soft active:scale-90"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          {mascotMsgs.length < 10 && (
            <button
              type="button"
              onClick={() => setMascotMsgs((prev) => [...prev, ""])}
              className="mt-2 rounded-full border border-line px-4 py-1.5 text-sm font-semibold transition hover:border-rose active:scale-95"
            >
              + Add a line
            </button>
          )}
        </section>

        <section id="settings-delivery" className="scroll-mt-24 rounded-2xl border border-line bg-white p-5">
          <h2 className="font-display text-lg font-semibold">Delivery &amp; orders</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Delivery fee (S$)
              <input
                className={inputClass}
                value={deliveryFee}
                onChange={(e) => setDeliveryFee(e.target.value)}
                inputMode="decimal"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Free delivery over (S$)
              <input
                className={inputClass}
                value={freeMin}
                onChange={(e) => setFreeMin(e.target.value)}
                inputMode="decimal"
              />
            </label>
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
              Lead time (days)
              <input
                className={inputClass}
                value={leadTime}
                onChange={(e) => setLeadTime(e.target.value)}
                inputMode="numeric"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Daily order cap
              <input
                className={inputClass}
                value={dailyCap}
                onChange={(e) => setDailyCap(e.target.value)}
                inputMode="numeric"
                placeholder="No limit"
              />
              <span className="font-normal text-muted">Max orders per day. Blank for no limit.</span>
            </label>
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Orders per time slot
              <input
                className={inputClass}
                value={perWindowCap}
                onChange={(e) => setPerWindowCap(e.target.value)}
                inputMode="numeric"
                placeholder="No limit"
              />
              <span className="font-normal text-muted">Max orders per time window. Blank for no limit.</span>
            </label>
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Same-day cutoff
              <input
                type="time"
                className={inputClass}
                value={cutoffTime}
                onChange={(e) => setCutoffTime(e.target.value)}
              />
              <span className="font-normal text-muted">After this time, the earliest order date moves a day later. Blank for none.</span>
            </label>
          </div>

          <DeliveryZones />
        </section>

        <section id="settings-pickup" className="scroll-mt-24 rounded-2xl border border-line bg-white p-5">
          <h2 className="font-display text-lg font-semibold">Pickup &amp; scheduling</h2>
          <label className="mt-4 flex flex-col gap-1 text-sm font-semibold">
            Pickup location (shown to customers)
            <input
              className={inputClass}
              value={pickupLocation}
              onChange={(e) => setPickupLocation(e.target.value)}
            />
          </label>
          <label className="mt-4 flex flex-col gap-1 text-sm font-semibold">
            Time windows (one per line)
            <textarea
              className={cn(inputClass, "min-h-24 resize-y")}
              value={windowsText}
              onChange={(e) => setWindowsText(e.target.value)}
            />
          </label>
        </section>

        <section id="settings-blackout" className="scroll-mt-24 rounded-2xl border border-line bg-white p-5">
          <h2 className="font-display text-lg font-semibold">Blackout dates</h2>
          <p className="mt-1 text-sm text-muted">Days you&rsquo;re away. Customers can&rsquo;t order for these.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {blackout.length === 0 && <span className="text-sm text-muted">None set.</span>}
            {blackout.map((date) => (
              <span
                key={date}
                className="inline-flex items-center gap-2 rounded-full bg-blush-soft px-3 py-1 text-sm font-semibold text-rose-deep"
              >
                {formatLongDate(date)}
                <button
                  type="button"
                  aria-label={`Remove ${date}`}
                  onClick={() => setBlackout((prev) => prev.filter((d) => d !== date))}
                  className="-m-1 flex h-7 w-7 items-center justify-center rounded-full text-rose-deep transition hover:text-rose active:scale-90"
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <input
              type="date"
              className={cn(inputClass, "max-w-44")}
              value={newBlackout}
              onChange={(e) => setNewBlackout(e.target.value)}
            />
            <button
              type="button"
              onClick={() => {
                if (newBlackout && !blackout.includes(newBlackout)) {
                  setBlackout((prev) => [...prev, newBlackout].sort());
                  setNewBlackout("");
                }
              }}
              className="rounded-full border border-line px-4 py-2 text-sm font-semibold transition hover:border-rose active:scale-95"
            >
              Add date
            </button>
          </div>
        </section>

        <section id="settings-rewards" className="scroll-mt-24 rounded-2xl border border-line bg-white p-5">
          <h2 className="font-display text-lg font-semibold">Rewards</h2>
          <p className="mt-1 text-sm text-muted">
            How customers earn and redeem loyalty points.
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Points earned per S$1 spent
              <input
                className={inputClass}
                value={pointsPerDollar}
                onChange={(e) => setPointsPerDollar(e.target.value)}
                inputMode="numeric"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Value per point (S$)
              <input
                className={inputClass}
                value={pointValue}
                onChange={(e) => setPointValue(e.target.value)}
                inputMode="decimal"
              />
            </label>
          </div>
          <p className="mt-3 text-sm text-muted">
            Example: a S$50 order earns{" "}
            <span className="font-semibold text-ink">
              {Math.max(0, parseInt(pointsPerDollar || "0", 10)) * 50} points
            </span>
            , worth{" "}
            <span className="font-semibold text-ink">
              S${((Math.max(0, parseInt(pointsPerDollar || "0", 10)) * 50 * toCents(pointValue)) / 100).toFixed(2)}
            </span>{" "}
            off a future order.
          </p>

          <h3 className="mt-6 text-sm font-semibold text-ink">Referrals</h3>
          <p className="mt-1 text-sm text-muted">
            Points awarded when a referred friend places their first order.
          </p>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Referrer earns (points)
              <input
                className={inputClass}
                value={referrerPts}
                onChange={(e) => setReferrerPts(e.target.value)}
                inputMode="numeric"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-semibold">
              New friend earns (points)
              <input
                className={inputClass}
                value={refereePts}
                onChange={(e) => setRefereePts(e.target.value)}
                inputMode="numeric"
              />
            </label>
          </div>
        </section>

        <section id="settings-merch" className="scroll-mt-24 rounded-2xl border border-line bg-white p-5">
          <h2 className="font-display text-lg font-semibold">Merchandising &amp; lifecycle</h2>
          <p className="mt-1 text-sm text-muted">
            Spend-gift, birthday rewards, and abandoned-cart timing (each also has an on/off
            switch below).
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Free gift over (S$)
              <input
                className={inputClass}
                value={giftThreshold}
                onChange={(e) => setGiftThreshold(e.target.value)}
                inputMode="decimal"
                placeholder="Off"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Free gift product
              <select
                className={inputClass}
                value={giftProductId}
                onChange={(e) => setGiftProductId(e.target.value)}
              >
                <option value="">None</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Birthday reward (points)
              <input
                className={inputClass}
                value={birthdayPoints}
                onChange={(e) => setBirthdayPoints(e.target.value)}
                inputMode="numeric"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Abandoned-cart reminder after (hours)
              <input
                className={inputClass}
                value={abandonedHours}
                onChange={(e) => setAbandonedHours(e.target.value)}
                inputMode="numeric"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Low-stock alert at
              <input
                className={inputClass}
                value={lowStock}
                onChange={(e) => setLowStock(e.target.value)}
                inputMode="numeric"
                placeholder="Off"
              />
              <span className="font-normal text-muted">Email me when a tracked item falls to this count. Blank to turn off.</span>
            </label>
          </div>
        </section>

        <section id="settings-notes" className="scroll-mt-24 rounded-2xl border border-line bg-white p-5">
          <h2 className="font-display text-lg font-semibold">Structured order notes</h2>
          <p className="mt-1 text-sm text-muted">
            Custom questions shown at checkout (e.g. &ldquo;Occasion?&rdquo;). Requires the
            &ldquo;Structured order notes&rdquo; feature below.
          </p>
          <div className="mt-4 flex flex-col gap-3">
            {notePrompts.length === 0 && (
              <p className="text-sm text-muted">No prompts yet.</p>
            )}
            {notePrompts.map((prompt, index) => (
              <div key={prompt.id} className="flex flex-wrap items-center gap-2">
                <input
                  className={cn(inputClass, "flex-1 min-w-40")}
                  value={prompt.label}
                  placeholder="Question shown to the customer"
                  onChange={(e) =>
                    setNotePrompts((prev) =>
                      prev.map((p, i) => (i === index ? { ...p, label: e.target.value } : p)),
                    )
                  }
                />
                <select
                  className={cn(inputClass, "max-w-32")}
                  value={prompt.type}
                  onChange={(e) =>
                    setNotePrompts((prev) =>
                      prev.map((p, i) =>
                        i === index ? { ...p, type: e.target.value as "text" | "boolean" } : p,
                      ),
                    )
                  }
                >
                  <option value="text">Text</option>
                  <option value="boolean">Yes / no</option>
                </select>
                <span className="flex items-center gap-2 text-sm font-normal">
                  <Toggle
                    checked={prompt.required}
                    onChange={(v) =>
                      setNotePrompts((prev) =>
                        prev.map((p, i) => (i === index ? { ...p, required: v } : p)),
                      )
                    }
                    label="Required"
                  />
                  Required
                </span>
                <button
                  type="button"
                  aria-label="Remove prompt"
                  onClick={() => setNotePrompts((prev) => prev.filter((_, i) => i !== index))}
                  className="rounded-full border border-line px-3 py-1.5 text-sm text-rose-deep transition hover:border-rose active:scale-90"
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() =>
                setNotePrompts((prev) => [
                  ...prev,
                  { id: crypto.randomUUID(), label: "", type: "text", required: false },
                ])
              }
              className="self-start rounded-full border border-line px-4 py-2 text-sm font-semibold transition hover:border-rose active:scale-95"
            >
              + Add prompt
            </button>
          </div>
        </section>

        <section id="settings-features" className="scroll-mt-24 rounded-2xl border border-line bg-white p-5">
          <h2 className="font-display text-lg font-semibold">Features</h2>
          <p className="mt-1 text-sm text-muted">
            Turn customer features on or off. Switched off, they disappear from the storefront.
          </p>
          <div className="mt-4 flex flex-col gap-3">
            {(
              [
                ["rewards", "Rewards & points", "Earn and redeem loyalty points."],
                ["wishlist", "Wishlist", "Customers save favourite treats (the ribbon)."],
                ["reviews", "Reviews & ratings", "Verified-buyer reviews on product pages."],
                ["promos", "Promo codes", "Discount codes at checkout."],
                ["gifting", "Gift orders", "Send an order as a gift with a message."],
                ["referrals", "Referrals", "Refer-a-friend reward codes."],
                ["buildABox", "Build a box", "Let customers mix their own box of treats."],
                ["bundles", "Bundles", "Curated set menus sold as one item."],
                ["spendGift", "Spend-gift nudge", "Free gift over a spend threshold."],
                ["backInStock", "Back-in-stock alerts", "Email customers when a sold-out item returns."],
                ["photoReviews", "Photo reviews", "Let reviewers attach photos."],
                ["cartSharing", "Cart sharing", "Share a basket as a link ('order this for me')."],
                ["wishlistSharing", "Wishlist sharing", "Share a read-only list of favourites."],
                ["instagram", "Instagram feed", "Show a curated grid of Instagram posts."],
                ["birthdayRewards", "Birthday rewards", "Grant points on a customer's birthday."],
                ["abandonedCart", "Abandoned-cart email", "Remind customers who didn't finish checkout."],
                ["structuredNotes", "Structured order notes", "Custom checkout questions you define."],
                ["orderChanges", "Order changes", "Let customers reschedule or request to cancel."],
                ["newsletter", "Newsletter", "Collect sign-ups and send updates."],
                ["drops", "Seasonal drops", "Schedule items to go live with a waitlist."],
                ["dietaryPrefs", "Dietary preferences", "Customers save dietary needs for a tailored menu."],
                ["occasionReminders", "Occasion reminders", "Customers save birthdays and we email a reorder nudge."],
              ] as const
            ).map(([key, label, desc]) => (
              <div key={key} className="flex items-start gap-3">
                <Toggle
                  checked={features[key]}
                  onChange={(v) => setFeatures((f) => ({ ...f, [key]: v }))}
                  label={label}
                  className="mt-0.5"
                />
                <span>
                  <span className="block text-sm font-semibold text-ink">{label}</span>
                  <span className="block text-sm text-muted">{desc}</span>
                </span>
              </div>
            ))}
          </div>
        </section>

        <div className="sticky bottom-4 z-10">
          <div className="flex items-center justify-between gap-4 rounded-2xl border border-line bg-white/95 px-5 py-3 shadow-soft backdrop-blur">
            <span role="status" aria-live="polite" className="text-sm">
              {saved ? (
                <span className="font-semibold text-success">Saved ✓</span>
              ) : dirty ? (
                <span className="font-semibold text-warning-ink">You have unsaved changes</span>
              ) : (
                <span className="text-muted">All changes saved</span>
              )}
            </span>
            <button
              type="button"
              onClick={handleSave}
              disabled={!dirty}
              className="rounded-full bg-rose-deep px-6 py-2.5 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:brightness-110 active:scale-95 disabled:pointer-events-none disabled:opacity-50"
            >
              Save settings
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

type TierDraft = { upToKmText: string; feeText: string };

/**
 * Kitchen postal + distance tiers, self-contained with its own load/save.
 * These never flow through AdminStore/updateSettings: the kitchen coordinates
 * are effectively the owner's home address, so they live only in the
 * service-role-only delivery_config table, behind the admin-gated actions.
 */
function DeliveryZones() {
  const [loading, setLoading] = useState(true);
  const [kitchenPostal, setKitchenPostal] = useState("");
  const [tiers, setTiers] = useState<TierDraft[]>([]);
  const [located, setLocated] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  // What was last loaded from, or saved to, the server. Compared against the
  // live draft below so an "unsaved changes" hint never drifts from reality,
  // the same approach the parent settings form uses for its own dirty flag.
  const [zonesBaseline, setZonesBaseline] = useState("");

  useEffect(() => {
    void (async () => {
      const config = await loadDeliveryConfigAction();
      const postal = config.kitchenPostal ?? "";
      const tierDrafts = config.tiers.map((t) => ({
        upToKmText: String(t.upToKm),
        feeText: (t.feeCents / 100).toFixed(2),
      }));
      setKitchenPostal(postal);
      setTiers(tierDrafts);
      setLocated(config.kitchenLat != null && config.kitchenLng != null);
      setZonesBaseline(JSON.stringify({ kitchenPostal: postal, tiers: tierDrafts }));
      setLoading(false);
    })();
  }, []);

  const zonesDirty = !loading && JSON.stringify({ kitchenPostal, tiers }) !== zonesBaseline;

  // Same tab-close warning the main settings form has, so unsaved kitchen and
  // distance-tier edits are protected like every other settings field.
  useEffect(() => {
    if (!zonesDirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [zonesDirty]);

  async function handleSave() {
    setSaving(true);
    setError("");
    setSaved(false);
    const parsedTiers: DistanceTier[] = tiers.map((t) => ({
      upToKm: parseFloat(t.upToKmText || "0"),
      feeCents: Math.max(0, Math.round(parseFloat(t.feeText || "0") * 100)),
    }));
    const res = await saveDeliveryConfigAction({
      kitchenPostal: kitchenPostal.trim(),
      tiers: parsedTiers,
    });
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    const postal = res.config.kitchenPostal ?? "";
    const tierDrafts = res.config.tiers.map((t) => ({
      upToKmText: String(t.upToKm),
      feeText: (t.feeCents / 100).toFixed(2),
    }));
    setKitchenPostal(postal);
    setTiers(tierDrafts);
    setLocated(res.config.kitchenLat != null && res.config.kitchenLng != null);
    setZonesBaseline(JSON.stringify({ kitchenPostal: postal, tiers: tierDrafts }));
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2000);
  }

  if (loading) {
    return <p className="mt-6 text-sm text-muted">Loading delivery zones…</p>;
  }

  return (
    <div className="mt-6 border-t border-line pt-5">
      <h3 className="text-sm font-semibold text-ink">Distance-based delivery zones</h3>
      <p className="mt-1 text-sm text-muted">
        Price delivery by driving distance from your kitchen. The flat delivery fee above stays
        the fallback: it&rsquo;s used until zones are set up here, or whenever an address
        can&rsquo;t be located. The farthest tier is unbounded, so its fee also covers any
        address beyond that distance, not just up to it.
      </p>

      <label className="mt-4 flex max-w-52 flex-col gap-1 text-sm font-semibold">
        Kitchen postal code
        <input
          className={inputClass}
          value={kitchenPostal}
          onChange={(e) => setKitchenPostal(e.target.value)}
          inputMode="numeric"
          maxLength={6}
          placeholder="e.g. 018956"
        />
      </label>

      <div className="mt-4 flex flex-col gap-2">
        {tiers.length === 0 && <p className="text-sm text-muted">No tiers yet.</p>}
        {tiers.map((tier, index) => (
          <div key={index} className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-sm font-normal">
              Up to
              <input
                className={cn(inputClass, "max-w-20")}
                value={tier.upToKmText}
                inputMode="decimal"
                aria-label="Up to (km)"
                onChange={(e) =>
                  setTiers((prev) =>
                    prev.map((t, i) => (i === index ? { ...t, upToKmText: e.target.value } : t)),
                  )
                }
              />
              km
            </label>
            <label className="flex items-center gap-2 text-sm font-normal">
              Fee S$
              <input
                className={cn(inputClass, "max-w-24")}
                value={tier.feeText}
                inputMode="decimal"
                aria-label="Fee (S$)"
                onChange={(e) =>
                  setTiers((prev) =>
                    prev.map((t, i) => (i === index ? { ...t, feeText: e.target.value } : t)),
                  )
                }
              />
            </label>
            <button
              type="button"
              aria-label="Remove tier"
              onClick={() => setTiers((prev) => prev.filter((_, i) => i !== index))}
              className="rounded-full border border-line px-3 py-1.5 text-sm text-rose-deep transition hover:border-rose active:scale-90"
            >
              ✕
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setTiers((prev) => [...prev, { upToKmText: "", feeText: "0.00" }])}
          className="self-start rounded-full border border-line px-4 py-1.5 text-sm font-semibold transition hover:border-rose active:scale-95"
        >
          + Add tier
        </button>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || !zonesDirty}
          className="rounded-full bg-rose-deep px-5 py-2 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:brightness-110 active:scale-95 disabled:pointer-events-none disabled:opacity-50"
        >
          Save delivery zones
        </button>
        {zonesDirty && !saving && (
          <span className="text-sm font-semibold text-warning-ink">Unsaved changes</span>
        )}
        <span role="status" aria-live="polite" className="text-sm">
          {error ? (
            <span className="font-semibold text-rose-deep">{error}</span>
          ) : saved ? (
            <span className="font-semibold text-success">Saved ✓</span>
          ) : null}
        </span>
      </div>
      {/* Persistent, unlike the transient "Saved" confirmation above: reflects
          what's actually on the server, so it survives a page reload instead
          of disappearing until the next save. */}
      {kitchenPostal.trim() && (
        <p className="mt-2 text-sm">
          {located ? (
            <span className="font-semibold text-success">Located ✓</span>
          ) : (
            <span className="text-muted">
              Not located yet — add your OneMap credentials, then save again.
            </span>
          )}
        </p>
      )}
    </div>
  );
}
