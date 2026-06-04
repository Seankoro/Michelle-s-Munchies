import type { Metadata } from "next";
import { RibbonDivider } from "@/components/ui/RibbonDivider";

export const metadata: Metadata = {
  title: "FAQ & Contact",
  description: "Lead times, delivery, allergens, and how to reach Michelle's Munchies.",
};

const faqs = [
  {
    q: "How far in advance should I order?",
    a: "Everything is baked to order, so we ask for at least 2 days' notice. Larger cakes may need a little longer.",
  },
  {
    q: "Do you deliver, or can I self-collect?",
    a: "Both! Self-pickup is free. Delivery is a flat island-wide fee, and it's free above a minimum order. You'll see the exact amounts at checkout.",
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
    a: "Because we bake to order, please reach out as early as possible and we'll do our best to help.",
  },
];

const contactMethods = [
  { label: "WhatsApp", value: "Message us on WhatsApp", icon: "💬" },
  { label: "Email", value: "hello@example.com", icon: "✉️" },
  { label: "Instagram", value: "@michelles.munchies", icon: "📸" },
];

export default function ContactPage() {
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
        {/* Placeholder contact details, swap in real handles/links. */}
        <ul className="mt-5 grid gap-4 sm:grid-cols-3">
          {contactMethods.map((method) => (
            <li
              key={method.label}
              className="rounded-2xl border border-line bg-white p-4 text-center"
            >
              <p className="text-3xl" aria-hidden="true">
                {method.icon}
              </p>
              <p className="mt-2 text-sm font-semibold uppercase tracking-wide text-rose">
                {method.label}
              </p>
              <p className="mt-1 text-sm text-muted">{method.value}</p>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
