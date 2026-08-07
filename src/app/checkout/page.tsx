"use client";

import {
  cloneElement,
  isValidElement,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
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
import {
  applyPromo,
  estimateDeliveryFeeAction,
  getDayCapacityAction,
  getPointsBalanceAction,
  placeOrder,
  recordCheckoutIntentAction,
  type DayCapacity,
} from "./actions";
import { subscribeNewsletterAction } from "@/lib/newsletter-actions";
import type { StoreSettings } from "@/lib/settings";
import { fetchClientSettingsRow } from "@/lib/client-settings";
import { singaporeNow } from "@/lib/time";
import { isValidSgPhone, normalizeSgPhone } from "@/lib/phone";
import { EMAIL_RE } from "@/lib/text";
import { useFeatures } from "@/components/features/FeaturesProvider";
import { CutoffBanner } from "@/components/checkout/CutoffBanner";
import { buttonClasses } from "@/components/ui/Button";
import { MascotSays } from "@/components/ui/MascotSays";
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
  // Point the control at its error text and flag it invalid, so screen readers
  // announce the problem and tie it to the right field.
  const errorId = `${htmlFor}-error`;
  const field =
    error && isValidElement(children)
      ? cloneElement(children as ReactElement<Record<string, unknown>>, {
          "aria-invalid": true,
          "aria-describedby": errorId,
        })
      : children;
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1 block text-sm font-semibold text-ink">
        {label}
        {optional && <span className="ml-1 font-normal text-muted">(optional)</span>}
      </label>
      {field}
      {error && (
        <p id={errorId} role="alert" className="mt-1 text-sm text-rose-ink">
          {error}
        </p>
      )}
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
    // No placeholder address. Until Michelle's own pickup location arrives the
    // line stays hidden rather than naming a neighbourhood she never chose.
    pickupLocation: "",
    dailyOrderCap: null,
    dailyCutoffTime: null,
    notePrompts: [],
  });
  // The windows and the pickup line come from a browser read, so nothing derived
  // from them is shown until it settles. Painting the fallbacks first would offer
  // slots Michelle may have cleared, then pull them seconds later.
  const [settingsLoaded, setSettingsLoaded] = useState(false);
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
  // No window is chosen until the live list says which ones exist.
  const [timeWindow, setTimeWindow] = useState("");
  const [dayCapacity, setDayCapacity] = useState<DayCapacity | null>(null);
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
  // Gift + delivery: let the recipient fill in their own address and time slot.
  const [letRecipientSchedule, setLetRecipientSchedule] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const flatDeliveryFeeCents = computeDeliveryFeeCents(subtotalCents, fulfillment, settings);
  // Distance-zoned estimate, filled in once a valid delivery postal code is
  // entered. Falls back to the flat fee until then, and reverts to it if the
  // shopper switches back to pickup or clears the postal code.
  const [zonedFeeCents, setZonedFeeCents] = useState<number | null>(null);
  const [deliveryFeePending, setDeliveryFeePending] = useState(false);
  const deliveryFeeCents =
    fulfillment === "delivery" && zonedFeeCents !== null ? zonedFeeCents : flatDeliveryFeeCents;

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
      // Live store settings, for every shopper, signed in or not. A read that
      // fails still has to settle, or the schedule picker waits for windows that
      // are never coming.
      const r = await fetchClientSettingsRow().catch(() => null);
      if (!active) return;
      if (r) {
        // An empty list is a real answer, not a missing value: it means Michelle
        // cleared every slot to stop taking bookings, so we offer none instead of
        // windows the server would reject.
        const windows = r.time_windows ?? mockSettings.timeWindows;
        const leadTimeDays = r.lead_time_days ?? mockSettings.leadTimeDays;
        setSettings({
          deliveryFeeCents: r.delivery_fee_cents ?? mockSettings.deliveryFeeCents,
          freeDeliveryMinCents: r.free_delivery_min_cents ?? mockSettings.freeDeliveryMinCents,
          minOrderCents: r.min_order_cents ?? mockSettings.minOrderCents,
          leadTimeDays,
          timeWindows: windows,
          blackoutDates: r.blackout_dates ?? mockSettings.blackoutDates,
          // Blank means she hasn't set a pickup address yet, so the line is hidden.
          pickupLocation: r.pickup_location_public?.trim() ?? "",
          dailyOrderCap: r.daily_order_cap,
          dailyCutoffTime: r.daily_cutoff_time,
          notePrompts: Array.isArray(r.note_prompts) ? r.note_prompts : [],
        });
        setPointValueCents(r.point_value_cents ?? 5);
        // Keep the chosen date/window valid under the live rules.
        const liveEarliest = earliestFulfillmentDate(leadTimeDays, singaporeNow(), r.daily_cutoff_time);
        setDate((cur) => (cur < liveEarliest ? liveEarliest : cur));
        setTimeWindow((cur) => (windows.includes(cur) ? cur : windows[0] ?? ""));
      }
      // Settled either way. A failed read leaves the same defaults the server
      // falls back to, so the form and the order check still agree.
      setSettingsLoaded(true);

      // Rewards balance, signed-in only. Fetched server-side so points held by
      // the customer's other unpaid orders are already subtracted, and the
      // preview never promises more than placeOrder will grant.
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || !active) return;
      const { balance } = await getPointsBalanceAction();
      if (!active) return;
      setPointsBalance(balance);
    })();
    return () => {
      active = false;
    };
  }, []);

  // Live capacity for the chosen date, so full slots show before submit.
  useEffect(() => {
    if (!date) {
      setDayCapacity(null);
      return;
    }
    let active = true;
    void getDayCapacityAction(date).then((cap) => {
      if (active) setDayCapacity(cap);
    });
    return () => {
      active = false;
    };
  }, [date]);

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
    if (!EMAIL_RE.test(trimmed)) return;
    const id = window.setTimeout(() => {
      void recordCheckoutIntentAction(
        trimmed,
        // Ids, not names. The server looks the names up in the catalogue, so no
        // text a caller chose can reach the reminder email it later sends.
        items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
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
    applyPoints && pointsBalance > 0 && pointValueCents > 0
      ? Math.floor(Math.min(pointsBalance * pointValueCents, roomAfterPromo) / pointValueCents) *
        pointValueCents
      : 0;
  const totalCents = subtotalCents + deliveryFeeCents - promoDiscountCents - pointsDiscountCents;

  // The per-customer cap is counted against the buyer's email, so send the one
  // they have typed and let a code they have already used be refused here
  // instead of at placement. While the field is empty or half-typed we send
  // nothing rather than an empty address, and the cap stays with the placeOrder
  // re-check, exactly as before.
  const typedEmail = email.trim();
  const promoEmail = EMAIL_RE.test(typedEmail) ? typedEmail : undefined;

  async function handleApplyPromo() {
    setPromoError("");
    if (!promoInput.trim()) return;
    setApplyingPromo(true);
    const result = await applyPromo(promoInput, subtotalCents, deliveryFeeCents, promoEmail).catch(
      () => null,
    );
    setApplyingPromo(false);
    if (!result) {
      // A rejected action carries no message of its own, so without this the
      // button comes back enabled and nothing at all is said about the code.
      setAppliedPromo(null);
      setPromoError("We couldn’t check that code just now. Please try again.");
      return;
    }
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

  // Re-validate the applied promo whenever the subtotal, delivery fee or typed
  // email changes, so the preview stays correct, like a free-delivery code as
  // fulfillment toggles, and so a code applied before the email was filled in
  // is refused here once the address says it has already been used.
  const appliedCode = appliedPromo?.code;
  useEffect(() => {
    if (!appliedCode) return;
    let active = true;
    // Debounced, because the typed email is one of the inputs now and a re-check
    // per keystroke would spend the promo action's rate limit, which comes back
    // as "too many tries" and would drop a code that was perfectly fine.
    const id = window.setTimeout(async () => {
      const result = await applyPromo(
        appliedCode,
        subtotalCents,
        deliveryFeeCents,
        promoEmail,
      ).catch(() => null);
      if (!active) return;
      // A rejected re-check says nothing about the code, so leave the applied
      // one alone. placeOrder recomputes it authoritatively anyway.
      if (!result) return;
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
    }, 500);
    return () => {
      active = false;
      window.clearTimeout(id);
    };
  }, [appliedCode, subtotalCents, deliveryFeeCents, promoEmail]);

  // Live distance-zoned delivery fee, fetched once the shopper has picked
  // delivery and entered a valid 6-digit postal code. Debounced so we don't
  // fire a geocode lookup on every keystroke. The server remains the source
  // of truth: placeOrder recomputes the fee itself, so this is purely a
  // preview for the summary.
  useEffect(() => {
    if (fulfillment !== "delivery" || !/^\d{6}$/.test(postalCode)) {
      setZonedFeeCents(null);
      setDeliveryFeePending(false);
      return;
    }
    let cancelled = false;
    const id = window.setTimeout(async () => {
      setDeliveryFeePending(true);
      try {
        const { feeCents } = await estimateDeliveryFeeAction(postalCode, subtotalCents);
        if (!cancelled) setZonedFeeCents(feeCents);
      } catch {
        if (!cancelled) setZonedFeeCents(null);
      } finally {
        if (!cancelled) setDeliveryFeePending(false);
      }
    }, 500);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [postalCode, fulfillment, subtotalCents]);

  if (!hydrated) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-16 text-center text-muted">Loading…</main>
    );
  }

  if (items.length === 0) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-20 text-center">
        <div className="flex justify-center">
          <MascotSays lines={["Nothing to check out yet… let's fix that."]} />
        </div>
        <h1 className="mt-6 font-display text-3xl font-semibold">Your cart is empty</h1>
        <p className="mt-2 text-muted">Add a treat or two before checking out.</p>
        <Link href="/menu" className={buttonClasses({ className: "mt-8", size: "lg" })}>
          Browse the menu
        </Link>
      </main>
    );
  }

  // Gift + delivery where the recipient will fill in their own address and slot,
  // so the buyer needn't know either. The date still anchors the bake schedule.
  const giftSelfSchedule = isGift && fulfillment === "delivery" && letRecipientSchedule;

  // The day is full when the daily cap is reached, or when every window has hit
  // the per-window cap. The second case matters because the select only ever
  // offers the window already chosen, so "pick another window" is advice the
  // form cannot take. Either way the date is what has to change.
  const perWindowCap = dayCapacity?.perWindowCap ?? null;
  const allWindowsFull =
    perWindowCap !== null &&
    perWindowCap > 0 &&
    settings.timeWindows.length > 0 &&
    settings.timeWindows.every((window) => (dayCapacity?.windowCounts[window] ?? 0) >= perWindowCap);
  const dailyCapReached =
    dayCapacity !== null &&
    dayCapacity.dailyOrderCap !== null &&
    dayCapacity.dailyOrderCap > 0 &&
    dayCapacity.dayCount >= dayCapacity.dailyOrderCap;

  // No windows at all means Michelle cleared every slot to stop taking bookings.
  // Offering the fallback three would book slots the server refuses, so the form
  // says so plainly and blocks submission. Only once settings land, so a slow
  // read never flashes the paused notice.
  const orderingPaused = settingsLoaded && settings.timeWindows.length === 0;

  function validate(): Record<string, string> {
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = "Please tell us your name.";
    if (!EMAIL_RE.test(email)) next.email = "Enter a valid email.";
    if (!isValidSgPhone(phone)) next.phone = "Enter a Singapore mobile number, e.g. 9123 4567.";
    if (!date) next.date = "Pick a date.";
    else if (date < earliest)
      next.date = `Earliest available is ${formatLongDate(earliest)} (we bake to order).`;
    else if (settings.blackoutDates.includes(date))
      next.date = "We're away that day. Please choose another date.";
    // The recipient picks the time window themselves when self-scheduling.
    if (!timeWindow && !giftSelfSchedule) next.timeWindow = "Pick a time window.";
    // Block a window that is already full up front, with the same rule the
    // server enforces, so a default-selected full slot fails before submit.
    else if (
      timeWindow &&
      !giftSelfSchedule &&
      dayCapacity?.perWindowCap &&
      dayCapacity.perWindowCap > 0 &&
      (dayCapacity.windowCounts[timeWindow] ?? 0) >= dayCapacity.perWindowCap
    ) {
      next.timeWindow = allWindowsFull
        ? "Every window on this date is taken. Please choose another date."
        : "That time slot is fully booked. Please pick another window.";
    }
    if (fulfillment === "delivery" && !giftSelfSchedule) {
      if (!line1.trim()) next.line1 = "Delivery address is required.";
      if (!/^\d{6}$/.test(postalCode)) next.postalCode = "Enter a 6-digit Singapore postal code.";
    }
    if (isGift && !recipientName.trim()) next.recipientName = "Who’s this gift for?";
    if (isGift && recipientPhone.trim() && !isValidSgPhone(recipientPhone))
      next.recipientPhone = "Enter a Singapore mobile number, e.g. 9123 4567.";
    if (features.structuredNotes) {
      for (const prompt of settings.notePrompts) {
        if (prompt.required && !(noteAnswers[prompt.id] ?? "").trim()) {
          next[`note-${prompt.id}`] = "Please answer this one.";
        }
      }
    }
    if (subtotalCents < settings.minOrderCents) {
      next.order = `Minimum order is ${formatPrice(settings.minOrderCents)}.`;
    }
    return next;
  }

  async function handleSubmit() {
    // Nothing to book while every window is cleared, and the server would refuse
    // the order anyway, so stop here rather than sending it.
    if (orderingPaused) return;
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
        // A recipient-self-schedule gift has no window yet, so send none instead
        // of a placeholder that would book and count against a real slot.
        timeWindow: giftSelfSchedule ? "" : timeWindow,
        address:
          fulfillment === "delivery" && !giftSelfSchedule
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
        recipientScheduling: giftSelfSchedule,
        noteAnswers: settings.notePrompts.map((p) => ({
          id: p.id,
          label: p.label,
          answer: (noteAnswers[p.id] ?? "").trim(),
        })),
      },
      applyPoints,
      appliedPromo?.code ?? "",
    ).catch(() => null);

    if (!result) {
      // A rejected action never returns a failure to show, so without this the
      // button stays disabled with nothing said and no way to try again. We
      // can't tell whether it reached us, so the wording doesn't claim either.
      setErrors({
        order: "We couldn’t send your order just now. Please check your connection and try again.",
      });
      setSubmitting(false);
      return;
    }

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
    // cancelled payment leaves the cart intact for another try. The marker
    // tells the tracking page this arrival follows a placed order, so email
    // revisits never wipe a future cart.
    try {
      window.sessionStorage.setItem("mm-order-placed", "1");
    } catch {
      // Storage blocked: the tracking page falls back to clearing anyway.
    }
    window.location.href = result.redirectUrl;
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <h1 className="font-display text-4xl font-semibold">Checkout</h1>
      <p className="mt-2 text-muted">No account needed. Just a few details and you&rsquo;re set.</p>
      {/* Answer "when do I pay?" before the form starts, not in a footnote. */}
      <ol className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm font-semibold">
        {["Your details", "Confirm on WhatsApp", "Pay by PayNow"].map((step, index) => (
          <li key={step} className="flex items-center gap-2">
            {index > 0 && (
              <span aria-hidden="true" className="text-muted">
                →
              </span>
            )}
            <span
              className={cn(
                "flex h-6 w-6 items-center justify-center rounded-full text-xs",
                index === 0 ? "bg-rose-deep text-white" : "bg-blush-soft text-rose-ink",
              )}
              aria-hidden="true"
            >
              {index + 1}
            </span>
            {step}
          </li>
        ))}
      </ol>

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
                      ? "Free · pick up from us"
                      : settings.freeDeliveryMinCents > 0 &&
                          subtotalCents >= settings.freeDeliveryMinCents
                        ? "Free delivery!"
                        : `from ${formatPrice(settings.deliveryFeeCents)} · by distance`}
                  </span>
                </button>
              ))}
            </div>
            {/* Only once she has saved an address. A blank one means she hasn't
                picked a spot yet, and a placeholder would send shoppers to a
                neighbourhood she never chose. */}
            {fulfillment === "pickup" && settings.pickupLocation && (
              <p className="mt-3 rounded-xl bg-marble/60 px-4 py-3 text-sm text-muted">
                📍 Pickup: {settings.pickupLocation}
              </p>
            )}
          </section>

          {/* Delivery address */}
          {fulfillment === "delivery" && giftSelfSchedule && (
            <section className="flex flex-col gap-2">
              <h2 className="font-display text-xl font-semibold">Delivery address</h2>
              <p className="rounded-xl bg-blush-soft/50 px-4 py-3 text-sm text-rose-ink">
                💌 The recipient will add their own address using the link we give you to share, so
                you don&rsquo;t need it here.
              </p>
            </section>
          )}
          {fulfillment === "delivery" && !giftSelfSchedule && (
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
                    onChange={(e) => setPostalCode(e.target.value.replace(/\D/g, ""))}
                    inputMode="numeric"
                    maxLength={6}
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
              <Field
                label="Date"
                htmlFor="date"
                error={
                  errors.date ||
                  (date && date < earliest
                    ? `Earliest available is ${formatLongDate(earliest)} (we bake to order).`
                    : date && settings.blackoutDates.includes(date)
                      ? "We're away that day. Please choose another date."
                      : undefined)
                }
              >
                <input
                  id="date"
                  type="date"
                  className={inputClass}
                  min={earliest}
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </Field>
              {!settingsLoaded ? (
                <Field label="Time window" htmlFor="timeWindow" error={errors.timeWindow}>
                  <p
                    id="timeWindow"
                    className="rounded-xl bg-marble/60 px-4 py-3 text-sm text-muted"
                  >
                    Loading available times…
                  </p>
                </Field>
              ) : orderingPaused ? (
                <Field label="Time window" htmlFor="timeWindow">
                  <p
                    id="timeWindow"
                    className="rounded-xl bg-marble/60 px-4 py-3 text-sm text-muted"
                  >
                    No time windows are open right now.
                  </p>
                </Field>
              ) : giftSelfSchedule ? (
                <Field label="Time window" htmlFor="timeWindow">
                  <p
                    id="timeWindow"
                    className="rounded-xl bg-marble/60 px-4 py-3 text-sm text-muted"
                  >
                    The recipient chooses their own time on the day you pick.
                  </p>
                </Field>
              ) : (
                <Field label="Time window" htmlFor="timeWindow" error={errors.timeWindow}>
                  <select
                    id="timeWindow"
                    className={inputClass}
                    value={timeWindow}
                    onChange={(e) => setTimeWindow(e.target.value)}
                  >
                    {settings.timeWindows.map((window) => {
                      const cap = dayCapacity?.perWindowCap ?? null;
                      const used = dayCapacity?.windowCounts[window] ?? 0;
                      const left = cap && cap > 0 ? cap - used : null;
                      const full = left != null && left <= 0;
                      return (
                        <option key={window} value={window} disabled={full && window !== timeWindow}>
                          {window}
                          {left != null ? (full ? " · full" : ` · ${left} left`) : ""}
                        </option>
                      );
                    })}
                  </select>
                </Field>
              )}
            </div>
            {orderingPaused && (
              <p role="status" className="rounded-xl bg-blush-soft/60 px-3 py-2 text-sm text-rose-ink">
                Ordering is paused right now. There are no pickup or delivery times open, so please
                check back soon.
              </p>
            )}
            {!orderingPaused && (dailyCapReached || allWindowsFull) && (
              <p role="status" className="rounded-xl bg-blush-soft/60 px-3 py-2 text-sm text-rose-ink">
                {formatLongDate(date)} is fully booked. Please choose another date.
              </p>
            )}
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
                {/* Subscribing is double opt-in, so the tick alone does nothing
                    until the confirmation link is tapped. Say so here, or the
                    confirmation email reads like a stray duplicate. */}
                <span>
                  Email me occasional updates and new treats. We&rsquo;ll send one email to confirm.
                  Tap the link inside to finish signing up. Unsubscribe any time.
                </span>
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
                    placeholder={
                      fulfillment === "delivery"
                        ? "So our courier can reach them on delivery"
                        : "In case we need to reach them"
                    }
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
                  <div className="flex items-start gap-3 rounded-xl border border-line bg-white p-3">
                    <Toggle
                      checked={letRecipientSchedule}
                      onChange={setLetRecipientSchedule}
                      label="Let them choose the delivery time and address"
                      className="mt-0.5"
                    />
                    <span className="text-sm">
                      <span className="block font-semibold text-ink">
                        Let them pick the time and address
                      </span>
                      <span className="block text-muted">
                        Don&rsquo;t know where they&rsquo;ll be? We&rsquo;ll give you a link to
                        share so they fill it in themselves.
                      </span>
                    </span>
                  </div>
                )}
                {fulfillment === "delivery" && !letRecipientSchedule && (
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
            <div className="mt-4" aria-live="polite">
              {appliedPromo ? (
                <div className="flex items-center justify-between gap-2 rounded-xl bg-blush-soft/60 p-3 text-sm text-rose-ink">
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
                    aria-label="Promo code"
                    className={cn(inputClass, "py-2 text-base uppercase sm:text-sm")}
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
              {promoError && <p className="mt-1 text-sm text-rose-ink">{promoError}</p>}
            </div>
            )}

            {features.rewards && pointsBalance > 0 && (
              <div className="mt-3 flex items-start gap-3 rounded-xl bg-blush-soft/60 p-3 text-sm text-rose-ink">
                <Toggle
                  checked={applyPoints}
                  onChange={setApplyPoints}
                  label="Use my points"
                  className="mt-0.5"
                />
                <span>
                  ✨ Use my {pointsBalance} {pointsBalance === 1 ? "point" : "points"}
                  {pointsDiscountCents > 0 && <> (−{formatPrice(pointsDiscountCents)})</>}
                </span>
              </div>
            )}

            <hr className="my-4 border-line" />
            <dl className="flex flex-col gap-2 text-sm" aria-live="polite">
              <div className="flex justify-between">
                <dt className="text-muted">Subtotal</dt>
                <dd>{formatPrice(subtotalCents)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">{fulfillment === "pickup" ? "Pickup" : "Delivery"}</dt>
                <dd className="text-right">
                  {deliveryFeeCents === 0 ? "Free" : formatPrice(deliveryFeeCents)}
                  {deliveryFeePending && (
                    <span className="block text-xs font-normal text-muted">
                      Calculating delivery…
                    </span>
                  )}
                </dd>
              </div>
              {promoDiscountCents > 0 && (
                <div className="flex justify-between text-rose-ink">
                  <dt>Promo ({appliedPromo?.code})</dt>
                  <dd>−{formatPrice(promoDiscountCents)}</dd>
                </div>
              )}
              {pointsDiscountCents > 0 && (
                <div className="flex justify-between text-rose-ink">
                  <dt>Rewards points</dt>
                  <dd>−{formatPrice(pointsDiscountCents)}</dd>
                </div>
              )}
              <div className="flex justify-between text-base font-semibold">
                <dt>Total</dt>
                <dd>{formatPrice(totalCents)}</dd>
              </div>
            </dl>

            <p className="mt-4 rounded-xl bg-marble/60 px-3 py-2 text-sm text-muted">
              No payment is taken here. Place your order, then send it to us on WhatsApp from the
              next page. We&rsquo;ll confirm it and reply with PayNow details so you can pay by
              transfer.
            </p>

            {dietaryConflicts.length > 0 && (
              <p
                role="status"
                className="mt-2 rounded-xl bg-blush-soft/60 px-3 py-2 text-sm text-rose-ink"
              >
                Heads up: {dietaryConflicts.join(", ")} may not match your saved dietary
                preferences. You can still order if that&rsquo;s fine.
              </p>
            )}

            {errors.order && (
              <p role="alert" className="mt-2 text-sm text-rose-ink">
                {errors.order}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting || orderingPaused}
              className={buttonClasses({ size: "lg", className: "mt-4 w-full" })}
            >
              {orderingPaused
                ? "Ordering is paused"
                : submitting
                  ? "Placing order…"
                  : `Place order · ${formatPrice(totalCents)}`}
            </button>
            <p className="mt-2 text-center text-xs text-muted">
              You&rsquo;ll pay by PayNow after confirming on WhatsApp.
            </p>
            <Link
              href="/cart"
              className="mt-3 block text-center text-sm font-semibold text-rose-ink transition hover:text-rose"
            >
              Back to cart
            </Link>
          </div>
        </aside>
      </form>
    </main>
  );
}
