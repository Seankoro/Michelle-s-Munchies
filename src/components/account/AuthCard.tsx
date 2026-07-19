import type { ReactNode } from "react";
import { RibbonBow } from "@/components/ui/RibbonBow";

/**
 * The shared shell for the account auth pages (sign in, sign up, forgot, reset):
 * the centered card with the ribbon and heading. Each page passes its own form,
 * error/pending region, and footer link as children, so per-page differences
 * (Google/magic-link, the referral field, pending styling) stay in the page.
 */
export function AuthCard({
  title,
  subtitle,
  children,
}: {
  title: ReactNode;
  subtitle: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto flex max-w-md flex-col px-6 py-16">
      <div className="rounded-2xl border border-line bg-white p-8 shadow-soft">
        <div className="flex flex-col items-center text-center">
          <RibbonBow withTails={false} className="h-10 w-12" />
          <h1 className="mt-3 font-display text-2xl font-semibold">{title}</h1>
          <p className="mt-1 text-sm text-muted">{subtitle}</p>
        </div>
        {children}
      </div>
    </main>
  );
}
