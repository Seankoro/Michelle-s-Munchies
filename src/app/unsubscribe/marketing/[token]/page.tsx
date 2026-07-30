import type { Metadata } from "next";
import { MarketingOptOutConfirm } from "@/components/newsletter/MarketingOptOutConfirm";

export const metadata: Metadata = {
  title: "Stop reminder emails",
  robots: { index: false, follow: false },
};

/**
 * One-click opt-out for the marketing email the cron sends: win-back nudges,
 * occasion reminders, birthday greetings, and abandoned-cart prompts. The token
 * is a path segment because it arrives from an email footer link.
 *
 * Kept separate from the newsletter unsubscribe beside it, because they are
 * different lists: this one suppresses an address across every marketing send,
 * while that one only removes a newsletter subscriber.
 */
export default async function MarketingOptOutPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return (
    <main className="mx-auto max-w-md px-6 py-20 text-center">
      <p className="text-5xl" aria-hidden="true">
        🎀
      </p>
      <h1 className="mt-4 font-display text-3xl font-semibold">Stop these emails</h1>
      <p className="mt-2 text-muted">
        This stops reminders and offers from Michelle&rsquo;s Munchies. Updates about an order
        you&rsquo;ve placed will still reach you, so you never miss a collection.
      </p>
      <MarketingOptOutConfirm token={token} />
    </main>
  );
}
