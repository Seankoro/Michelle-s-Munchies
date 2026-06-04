import type { Metadata } from "next";
import { fetchProducts } from "@/lib/products";
import { fetchStoreSettings } from "@/lib/settings";
import { createServerSupabase } from "@/lib/supabase/server";
import { MenuBrowser } from "@/components/product/MenuBrowser";
import { Reveal } from "@/components/ui/Reveal";
import type { DietaryTag } from "@/lib/types";

export const metadata: Metadata = {
  title: "Menu",
  description: "Browse Michelle's Munchies cheesecakes, cookies, macarons and cakes, freshly baked to order.",
};

export default async function MenuPage() {
  const products = await fetchProducts();
  const categories = Array.from(new Set(products.map((product) => product.category)));

  // Pre-apply the signed-in customer's saved dietary preferences (when enabled).
  let initialDietary: DietaryTag[] = [];
  if ((await fetchStoreSettings()).features.dietaryPrefs) {
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const { data } = await supabase
        .from("profiles")
        .select("dietary_prefs")
        .eq("id", user.id)
        .maybeSingle();
      const prefs = (data as { dietary_prefs: DietaryTag[] | null } | null)?.dietary_prefs ?? [];
      // Only keep tags some product actually carries, so we never empty the menu.
      initialDietary = prefs.filter((tag) => products.some((p) => p.dietaryTags.includes(tag)));
    }
  }

  return (
    <main className="mx-auto max-w-none px-6 py-12 lg:px-10">
      <Reveal>
        <header className="text-center">
          <h1 className="font-display text-4xl font-semibold sm:text-5xl">Our Menu</h1>
          <p className="mx-auto mt-3 max-w-xl text-muted">
            Everything is baked to order. Browse, choose your options, and add to cart.
            You&rsquo;ll pick pickup or delivery at checkout.
          </p>
        </header>
      </Reveal>

      <div className="mt-10">
        <MenuBrowser products={products} categories={categories} initialDietary={initialDietary} />
      </div>
    </main>
  );
}
