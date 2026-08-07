import { fetchProducts } from "@/lib/products";
import { fetchStoreSettings } from "@/lib/settings";
import { fetchActiveBundles } from "@/lib/bundles";
import { fetchActiveBoxTemplates } from "@/lib/boxes";

// Served as a plain route instead of the sitemap.ts file convention because
// Next's metadata-route loader breaks on this project's apostrophe path.

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export async function GET() {
  const settings = await fetchStoreSettings();
  // The listing pages were here but not the pages themselves, so every bundle
  // and box was invisible to search. These are the gift-shaped pages, which is
  // most of what a bakery gets found for.
  const [products, bundles, boxes] = await Promise.all([
    fetchProducts(),
    settings.features.bundles ? fetchActiveBundles() : Promise.resolve([]),
    settings.features.buildABox ? fetchActiveBoxTemplates() : Promise.resolve([]),
  ]);

  const staticPaths = [
    { path: "", priority: "1.0" },
    { path: "/menu", priority: "0.8" },
    { path: "/about", priority: "0.8" },
    { path: "/contact", priority: "0.8" },
    ...(settings.features.bundles ? [{ path: "/bundles", priority: "0.8" }] : []),
    ...(settings.features.buildABox ? [{ path: "/build-a-box", priority: "0.8" }] : []),
  ];

  const lastmod = new Date().toISOString().slice(0, 10);
  const entries = [
    ...staticPaths.map(({ path, priority }) => ({ loc: `${SITE_URL}${path}`, priority })),
    ...products.map((product) => ({
      loc: `${SITE_URL}/menu/${product.slug}`,
      priority: "0.6",
    })),
    ...bundles.map((bundle) => ({ loc: `${SITE_URL}/bundles/${bundle.slug}`, priority: "0.6" })),
    ...boxes.map((box) => ({ loc: `${SITE_URL}/build-a-box/${box.slug}`, priority: "0.6" })),
  ]
    .map(
      ({ loc, priority }) =>
        `<url><loc>${loc}</loc><lastmod>${lastmod}</lastmod><priority>${priority}</priority></url>`,
    )
    .join("");

  const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries}</urlset>`;
  return new Response(xml, { headers: { "Content-Type": "application/xml" } });
}
