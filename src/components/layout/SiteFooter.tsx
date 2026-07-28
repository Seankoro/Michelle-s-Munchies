import Link from "next/link";
import Image from "next/image";
import { RibbonDivider } from "@/components/ui/RibbonDivider";
import { primaryNav } from "@/lib/nav";

/** Contact channel link. Computed server-side in the layout, since the values
 *  come from server-only env, then passed in because the footer renders inside
 *  the client SiteChrome. */
export type FooterChannel = { href: string; label: string; external: boolean };

export function SiteFooter({ channels = [] }: { channels?: FooterChannel[] }) {
  return (
    <footer className="mt-24 border-t border-line bg-marble/40">
      <div className="mx-auto max-w-none px-6 py-12 lg:px-10">
        <RibbonDivider className="mb-10" />

        <div className="grid gap-8 sm:grid-cols-3">
          <div>
            <div className="flex items-center gap-2">
              <Image src="/logo.png" alt="" width={512} height={512} className="h-9 w-9" />
              <p className="font-hand text-2xl font-semibold">Michelle&rsquo;s Munchies</p>
            </div>
            <p className="mt-2 max-w-xs text-sm text-muted">
              A home-based bakery in Singapore, baking fresh to order.
            </p>
            {channels.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-sm">
                {channels.map((channel) => (
                  <a
                    key={channel.href}
                    href={channel.href}
                    {...(channel.external
                      ? { target: "_blank", rel: "noopener noreferrer" }
                      : {})}
                    className="font-semibold text-rose-deep transition hover:text-rose"
                  >
                    {channel.label}
                  </a>
                ))}
              </div>
            )}
          </div>

          <nav aria-label="Footer">
            <p className="mb-3 text-sm font-semibold uppercase tracking-wide text-rose-deep">
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
            <p className="mb-3 text-sm font-semibold uppercase tracking-wide text-rose-deep">
              Good to know
            </p>
            <ul className="flex flex-col gap-2 text-sm text-muted">
              <li>Made to order · please order ahead</li>
              <li>Self-pickup or islandwide delivery</li>
              <li>Pay by PayNow, arranged over WhatsApp</li>
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
