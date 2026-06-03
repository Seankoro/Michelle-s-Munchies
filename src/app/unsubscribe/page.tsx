import type { Metadata } from "next";
import { UnsubscribeConfirm } from "@/components/newsletter/UnsubscribeConfirm";

export const metadata: Metadata = { title: "Unsubscribe", robots: { index: false, follow: false } };

export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return (
    <main className="mx-auto max-w-md px-6 py-20 text-center">
      <p className="text-5xl" aria-hidden="true">
        🎀
      </p>
      <h1 className="mt-4 font-display text-3xl font-semibold">Unsubscribe</h1>
      <p className="mt-2 text-muted">Stop receiving newsletter emails from Michelle&rsquo;s Munchies.</p>
      <UnsubscribeConfirm token={token ?? ""} />
    </main>
  );
}
