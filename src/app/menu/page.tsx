import type { Metadata } from "next";
import { fetchProducts, toCardProduct } from "@/lib/products";
import { fetchStoreSettings } from "@/lib/settings";
import { fetchAllRatings } from "@/lib/reviews";
import { createServerSupabase } from "@/lib/supabase/server";
import { MenuBrowser } from "@/components/product/MenuBrowser";
import { Reveal } from "@/components/ui/Reveal";
import type { DietaryTag } from "@/lib/types";

export const metadata: Metadata = {
  title: "Menu",
  description: "Browse Michelle's Munchies cheesecakes, cookies, macarons and cakes, freshly baked to order.",
};

export default async function MenuPage() {
  // Settings first, because the two feature flags below decide whether the
  // other reads happen at all. Everything after it is independent, so it runs
  // together rather than as a queue of round trips the customer waits through
  // one at a time.
  const settings = await fetchStoreSettings();

  const [products, ratings, dietaryPrefs] = await Promise.all([
    fetchProducts(),
    // Star lines on the cards, social proof where browsing actually happens.
    settings.features.reviews ? fetchAllRatings() : Promise.resolve({}),
    // The signed-in customer's saved dietary preferences. getUser has to finish
    // before the profile row can be asked for, so this pair is the only part
    // that genuinely has to be serial.
    (async (): Promise<DietaryTag[]> => {
      if (!settings.features.dietaryPrefs) return [];
      const supabase = await createServerSupabase();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return [];
      const { data } = await supabase
        .from("profiles")
        .select("dietary_prefs")
        .eq("id", user.id)
        .maybeSingle();
      return (data as { dietary_prefs: DietaryTag[] | null } | null)?.dietary_prefs ?? [];
    })(),
  ]);

  const categories = Array.from(new Set(products.map((product) => product.category)));
  // Only keep tags some product actually carries, so we never empty the menu.
  const initialDietary = dietaryPrefs.filter((tag) =>
    products.some((p) => p.dietaryTags.includes(tag)),
  );

  return (
    <main className="mx-auto max-w-none px-6 py-12 lg:px-10">
      <Reveal>
        <header className="text-center">
          <h1 className="font-display text-4xl font-semibold sm:text-5xl">Our menu</h1>
          <p className="mx-auto mt-3 max-w-xl text-muted">
            Everything is baked to order. Browse, choose your options, and add to cart.
            You&rsquo;ll pick pickup or delivery at checkout.
          </p>
        </header>
      </Reveal>

      <div className="mt-10">
        <MenuBrowser
          products={products.map(toCardProduct)}
          categories={categories}
          initialDietary={initialDietary}
          ratings={ratings}
        />
      </div>
    </main>
  );
}
