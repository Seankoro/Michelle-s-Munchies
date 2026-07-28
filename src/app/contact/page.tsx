import type { Metadata } from "next";
import { RibbonDivider } from "@/components/ui/RibbonDivider";
import { fetchStoreSettings } from "@/lib/settings";
import { getShopWhatsAppNumber } from "@/lib/whatsapp";
import { formatPrice } from "@/lib/catalog";

export const metadata: Metadata = {
  title: "FAQ & Contact",
  description: "Lead times, delivery, allergens, and how to reach Michelle's Munchies.",
};

// Render per request so the FAQ's lead-time and delivery numbers track the
// live admin settings instead of freezing at build time.
export const dynamic = "force-dynamic";

export default async function ContactPage() {
  // Live settings so the FAQ never contradicts what admin has configured.
  const settings = await fetchStoreSettings();

  const faqs = [
    {
      q: "How far in advance should I order?",
      a: `Everything is baked to order, so we ask for at least ${settings.leadTimeDays} ${settings.leadTimeDays === 1 ? "day's" : "days'"} notice. Larger cakes may need a little longer.`,
    },
    {
      q: "Do you deliver, or can I pick up my order?",
      a: `Both! Self-pickup is free. Delivery is priced by distance from our kitchen, starting from ${formatPrice(settings.deliveryFeeCents)}${settings.freeDeliveryMinCents > 0 ? `, and it's free for orders over ${formatPrice(settings.freeDeliveryMinCents)}` : ""}.`,
    },
    {
      q: "How do I pay?",
      a: "Place your order on the site, then we confirm it with you over WhatsApp and send a PayNow number or QR to pay by transfer.",
    },
    {
      q: "I have an allergy. Can you help?",
      a: "Each product lists its allergens and full ingredients. Our kitchen handles gluten, dairy, eggs, nuts and soy, so we can't guarantee an allergen-free environment. If in doubt, message us before ordering.",
    },
    {
      q: "Can treats be made for dietary needs, like no pork, vegetarian, or gluten free?",
      a: "Many can. Several treats are already vegetarian, eggless, or gluten free, like the Basque cheesecakes and the macarons, and you can filter the menu by dietary tag to find them. The strawberry jelly cheesecake can also be made with no-pork beef gelatine on request. Just add a note with your order and we will sort it out.",
    },
    {
      q: "Can I cancel or change my order?",
      a: "You can reschedule your date and time yourself from your order tracking page while the order is still being prepared. For anything else, message us as early as possible and we'll do our best to help.",
    },
  ];

  // Contact channels light up as links once their env values are configured.
  const waNumber = getShopWhatsAppNumber();
  const contactEmail = process.env.CONTACT_EMAIL ?? "";
  const instaHandle = (process.env.INSTAGRAM_HANDLE ?? "").replace(/^@/, "");

  const contactMethods = [
    {
      label: "WhatsApp",
      value: waNumber ? "Chat with us" : "Message us on WhatsApp",
      href: waNumber ? `https://wa.me/${waNumber}` : null,
      icon: "💬",
    },
    contactEmail
      ? {
          label: "Email",
          value: contactEmail,
          href: `mailto:${contactEmail}`,
          icon: "✉️",
        }
      : null,
    {
      label: "Instagram",
      value: instaHandle ? `@${instaHandle}` : "@michelles.munchies",
      href: instaHandle ? `https://instagram.com/${instaHandle}` : null,
      icon: "📸",
    },
  ].filter((method): method is NonNullable<typeof method> => method !== null);

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <header className="text-center">
        <h1 className="font-display text-4xl font-semibold sm:text-5xl">FAQ &amp; Contact</h1>
        <p className="mx-auto mt-3 max-w-xl text-muted">
          Everything you might want to know, and how to reach us.
        </p>
      </header>

      <RibbonDivider className="my-10" />

      <section aria-label="Frequently asked questions" className="space-y-3">
        {faqs.map((faq) => (
          <details
            key={faq.q}
            className="group rounded-2xl border border-line bg-white p-4"
          >
            <summary className="cursor-pointer list-none font-display text-lg font-semibold marker:hidden">
              <span className="flex items-center justify-between gap-3">
                {faq.q}
                <span className="text-rose-deep transition group-open:rotate-45" aria-hidden="true">
                  +
                </span>
              </span>
            </summary>
            <p className="mt-3 text-muted">{faq.a}</p>
          </details>
        ))}
      </section>

      <section className="mt-12">
        <h2 className="font-display text-2xl font-semibold">Get in touch</h2>
        <ul className="mt-5 grid gap-4 sm:grid-cols-3">
          {contactMethods.map((method) => {
            const card = (
              <>
                <p className="text-3xl" aria-hidden="true">
                  {method.icon}
                </p>
                <p className="mt-2 text-sm font-semibold uppercase tracking-wide text-rose-deep">
                  {method.label}
                </p>
                <p className="mt-1 text-sm text-muted">{method.value}</p>
              </>
            );
            return (
              <li key={method.label}>
                {method.href ? (
                  <a
                    href={method.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block rounded-2xl border border-line bg-white p-4 text-center transition hover:-translate-y-0.5 hover:border-rose hover:shadow-soft active:scale-[0.98]"
                  >
                    {card}
                  </a>
                ) : (
                  <div className="rounded-2xl border border-line bg-white p-4 text-center">
                    {card}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </main>
  );
}
