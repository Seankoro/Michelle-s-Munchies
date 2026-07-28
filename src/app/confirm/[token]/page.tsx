import Link from "next/link";
import type { Metadata } from "next";
import { confirmStockSubscription } from "@/lib/stock-notify";
import { confirmNewsletterSubscription } from "@/lib/newsletter";

export const metadata: Metadata = {
  title: "Confirm your email · Michelle's Munchies",
  robots: { index: false },
};

/**
 * Double-opt-in landing page. The token belongs to either a back-in-stock
 * alert or the newsletter; whichever matches gets confirmed. Idempotent, so
 * clicking the email link twice still shows the happy path.
 */
export default async function ConfirmSubscriptionPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  let heading = "That link has expired";
  let message =
    "We couldn't match this confirmation link. It may have already been used from another device, or the subscription was removed. Feel free to subscribe again.";
  let confirmed = false;

  const productName = await confirmStockSubscription(token);
  if (productName) {
    confirmed = true;
    heading = "You're on the list! 🎀";
    message = `We'll email you the moment ${productName} is back in stock.`;
  } else if (await confirmNewsletterSubscription(token)) {
    confirmed = true;
    heading = "You're on the list! 🎀";
    message = "Thanks for confirming. Treats, drops, and news are headed your way.";
  }

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center px-6 py-16 text-center">
      <div className="w-full rounded-3xl border border-line bg-white p-8 shadow-card">
        <p className="text-4xl">{confirmed ? "💌" : "🕰️"}</p>
        <h1 className="mt-4 font-display text-2xl text-ink">{heading}</h1>
        <p className="mt-3 text-sm text-muted">{message}</p>
        <Link
          href="/menu"
          className="mt-6 inline-block rounded-full bg-rose-deep px-6 py-2.5 text-sm font-semibold text-white transition hover:brightness-110"
        >
          Browse the menu
        </Link>
      </div>
    </main>
  );
}
