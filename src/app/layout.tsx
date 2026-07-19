import type { Metadata, Viewport } from "next";
import { Fraunces, Nunito } from "next/font/google";
import "./globals.css";
import { SiteChrome } from "@/components/layout/SiteChrome";
import type { FooterChannel } from "@/components/layout/SiteFooter";
import { CartProvider } from "@/components/cart/CartContext";
import { fetchFeatureFlags } from "@/lib/settings";
import { getShopWhatsAppNumber } from "@/lib/whatsapp";

// Display serif, soft, elegant, a touch of charm, the "marble Pantheon" calm.
const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
});

// Body sans, rounded and friendly with the Sylveon cuteness, still very readable.
const nunito = Nunito({
  subsets: ["latin"],
  variable: "--font-nunito",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: {
    default: "Michelle's Munchies · Freshly baked to order",
    template: "%s · Michelle's Munchies",
  },
  description:
    "A home-based bakery in Singapore. Freshly baked treats, made to order for self-pickup or delivery.",
  icons: {
    icon: "/icon.png",
    apple: "/apple-icon.png",
  },
  openGraph: {
    title: "Michelle's Munchies · Freshly baked to order",
    description:
      "A home-based bakery in Singapore. Freshly baked treats, made to order for self-pickup or delivery.",
    siteName: "Michelle's Munchies",
    locale: "en_SG",
    type: "website",
    images: [{ url: "/og.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    images: ["/og.png"],
  },
};

export const viewport: Viewport = {
  themeColor: "#fff7f9",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const features = await fetchFeatureFlags();

  // Contact channels light up as footer links once their env values are set.
  // Computed here because the footer renders inside the client SiteChrome and
  // these values come from server-only env.
  const waNumber = getShopWhatsAppNumber();
  const contactEmail = process.env.CONTACT_EMAIL ?? "";
  const instaHandle = (process.env.INSTAGRAM_HANDLE ?? "").replace(/^@/, "");
  const footerChannels = [
    waNumber && { href: `https://wa.me/${waNumber}`, label: "💬 WhatsApp", external: true },
    contactEmail && { href: `mailto:${contactEmail}`, label: "✉️ Email", external: false },
    instaHandle && {
      href: `https://instagram.com/${instaHandle}`,
      label: "📸 Instagram",
      external: true,
    },
  ].filter(Boolean) as FooterChannel[];

  return (
    <html lang="en" className={`${fraunces.variable} ${nunito.variable}`}>
      <body>
        <CartProvider>
          <SiteChrome features={features} footerChannels={footerChannels}>
            {children}
          </SiteChrome>
        </CartProvider>
      </body>
    </html>
  );
}
