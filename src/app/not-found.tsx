import Link from "next/link";
import { MascotSays } from "@/components/ui/MascotSays";
import { buttonClasses } from "@/components/ui/Button";

/**
 * Branded 404 for every notFound() call and mistyped URL, so nobody lands on
 * the stark framework default.
 */
export default function NotFound() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-24 text-center">
      <div className="flex justify-center">
        <MascotSays lines={["Oh crumbs, this page seems to have been eaten."]} />
      </div>
      <h1 className="mt-6 font-display text-4xl font-semibold">We couldn&rsquo;t find that page</h1>
      <p className="mt-2 text-muted">The treats are this way instead.</p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
        <Link href="/menu" className={buttonClasses({ size: "lg" })}>
          Browse the menu
        </Link>
        <Link href="/track" className={buttonClasses({ variant: "secondary", size: "lg" })}>
          Track an order
        </Link>
      </div>
    </main>
  );
}
