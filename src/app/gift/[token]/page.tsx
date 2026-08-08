import type { Metadata } from "next";
import Link from "next/link";
import { getGiftByToken } from "@/lib/orders-db";
import { fetchStoreSettings } from "@/lib/settings";
import { formatLongDate } from "@/lib/order";
import { buttonClasses } from "@/components/ui/Button";
import { MascotSays } from "@/components/ui/MascotSays";
import { GiftScheduleForm } from "@/components/gift/GiftScheduleForm";

export const metadata: Metadata = {
  title: "A treat is on the way",
  robots: { index: false, follow: false },
};

export default async function GiftSchedulePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const settings = await fetchStoreSettings();
  // The gifting feature flag only stops new gift purchases at checkout. A gift
  // that is already bought and sent still needs somewhere to go, so the token
  // alone decides whether this page loads. Otherwise switching gifting off would
  // tell the recipient their perfectly good link had expired.
  const gift = await getGiftByToken(token);

  if (!gift) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-20 text-center">
        <div className="flex justify-center">
          <MascotSays lines={["Hmm, I can't find that gift…"]} />
        </div>
        <h1 className="mt-6 font-display text-3xl font-semibold">Gift not found</h1>
        <p className="mt-2 text-muted">This link may be incorrect or expired.</p>
        <Link href="/menu" className={buttonClasses({ className: "mt-8", size: "lg" })}>
          Visit the bakery
        </Link>
      </main>
    );
  }

  const senderFirst = gift.sender_name.split(" ")[0];
  const recipientFirst = gift.recipient_name?.split(" ")[0] || "there";
  const scheduled = Boolean(gift.recipient_scheduled_at);
  const cancelled = gift.status === "cancelled";

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <div className="text-center">
        <div className="flex justify-center">
          <MascotSays lines={[scheduled ? "All set, see you soon!" : "Someone sent you a treat!"]} />
        </div>
        <h1 className="mt-6 font-display text-4xl font-semibold">
          Hi {recipientFirst}! 🎁
        </h1>
        <p className="mt-2 text-muted">
          {senderFirst} sent you a treat from Michelle&rsquo;s Munchies for{" "}
          <span className="font-semibold text-ink">{formatLongDate(gift.scheduled_date)}</span>.
        </p>
      </div>

      {gift.gift_message && (
        <div className="mt-6 rounded-2xl bg-blush-soft/60 p-5 text-center text-sm text-rose-ink">
          <p className="italic">&ldquo;{gift.gift_message}&rdquo;</p>
          <p className="mt-1 text-rose-ink">with love, {senderFirst}</p>
        </div>
      )}

      {cancelled ? (
        <p className="mt-8 rounded-2xl bg-marble/60 p-5 text-center font-semibold text-muted">
          This gift was cancelled. Please reach out to {senderFirst} if that&rsquo;s unexpected.
        </p>
      ) : scheduled ? (
        <div className="mt-8 rounded-2xl border border-line bg-white p-6 text-center">
          <p className="font-display text-2xl font-semibold text-rose-ink">You&rsquo;re all set! 🎀</p>
          <p className="mt-2 text-sm text-muted">
            We have your delivery details for {formatLongDate(gift.scheduled_date)}
            {gift.time_window ? ` · ${gift.time_window}` : ""}. Keep an eye out!
          </p>
          {gift.delivery_address && (
            <p className="mt-2 text-sm">
              {gift.delivery_address.line1}
              {gift.delivery_address.unit ? `, ${gift.delivery_address.unit}` : ""}, Singapore{" "}
              {gift.delivery_address.postalCode}
            </p>
          )}
        </div>
      ) : gift.fulfillment_type === "delivery" ? (
        <>
          <p className="mt-8 text-center text-sm text-muted">
            Just let us know where and when to bring it, and it&rsquo;s all yours.
          </p>
          <GiftScheduleForm token={token} timeWindows={settings.timeWindows} />
        </>
      ) : (
        // Defensive: checkout only mints a recipient token for delivery gifts, so
        // this pickup branch isn't reachable through the app, only for a pickup
        // gift row created directly in the DB.
        <div className="mt-8 rounded-2xl border border-line bg-white p-6 text-center text-sm text-muted">
          {senderFirst} arranged a pickup for you on {formatLongDate(gift.scheduled_date)}
          {gift.time_window ? ` · ${gift.time_window}` : ""}. See you then!
        </div>
      )}

      <div className="mt-10 text-center">
        <Link
          href="/menu"
          className="text-sm font-semibold text-rose-ink transition hover:text-rose"
        >
          Peek at the menu
        </Link>
      </div>
    </main>
  );
}
