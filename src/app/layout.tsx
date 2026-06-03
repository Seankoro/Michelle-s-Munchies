import type { Metadata } from "next";
import { Fraunces, Nunito } from "next/font/google";
import "./globals.css";
import { SiteChrome } from "@/components/layout/SiteChrome";
import { CartProvider } from "@/components/cart/CartContext";
import { fetchFeatureFlags } from "@/lib/settings";

// Display serif — soft, elegant, a touch of charm (the "marble Pantheon" calm).
const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
});

// Body sans — rounded and friendly (the Sylveon cuteness), still very readable.
const nunito = Nunito({
  subsets: ["latin"],
  variable: "--font-nunito",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Michelle's Munchies · Freshly baked to order",
    template: "%s · Michelle's Munchies",
  },
  description:
    "A home-based bakery in Singapore. Freshly baked treats, made to order for self-pickup or delivery.",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const features = await fetchFeatureFlags();
  return (
    <html lang="en" className={`${fraunces.variable} ${nunito.variable}`}>
      <body>
        <CartProvider>
          <SiteChrome features={features}>{children}</SiteChrome>
        </CartProvider>
      </body>
    </html>
  );
}
