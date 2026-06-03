import Link from "next/link";
import { RibbonDivider } from "@/components/ui/RibbonDivider";
import { primaryNav } from "@/lib/nav";

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-line bg-marble/40">
      <div className="mx-auto max-w-none px-6 py-12 lg:px-10">
        <RibbonDivider className="mb-10" />

        <div className="grid gap-8 sm:grid-cols-3">
          <div>
            <p className="font-display text-xl font-semibold">Michelle&rsquo;s Munchies</p>
            <p className="mt-2 max-w-xs text-sm text-muted">
              A home-based bakery in Singapore, baking fresh to order.
            </p>
          </div>

          <nav aria-label="Footer">
            <p className="mb-3 text-sm font-semibold uppercase tracking-wide text-rose">
              Explore
            </p>
            <ul className="flex flex-col gap-2 text-sm">
              {primaryNav.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="text-ink transition hover:text-rose-deep">
                    {link.label}
                  </Link>
                </li>
              ))}
              <li>
                <Link href="/track" className="text-ink transition hover:text-rose-deep">
                  Track an order
                </Link>
              </li>
            </ul>
          </nav>

          <div>
            <p className="mb-3 text-sm font-semibold uppercase tracking-wide text-rose">
              Good to know
            </p>
            <ul className="flex flex-col gap-2 text-sm text-muted">
              <li>Made to order · please order ahead</li>
              <li>Self-pickup or islandwide delivery</li>
              <li>PayNow · cards · Apple&nbsp;/&nbsp;Google&nbsp;Pay</li>
            </ul>
          </div>
        </div>

        <p className="mt-10 text-xs text-muted">
          © {new Date().getFullYear()} Michelle&rsquo;s Munchies. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
