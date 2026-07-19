import { fetchProducts } from "@/lib/products";
import { fetchStoreSettings } from "@/lib/settings";

// Served as a plain route instead of the sitemap.ts file convention because
// Next's metadata-route loader breaks on this project's apostrophe path.

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export async function GET() {
  const [products, settings] = await Promise.all([fetchProducts(), fetchStoreSettings()]);

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
  ]
    .map(
      ({ loc, priority }) =>
        `<url><loc>${loc}</loc><lastmod>${lastmod}</lastmod><priority>${priority}</priority></url>`,
    )
    .join("");

  const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries}</urlset>`;
  return new Response(xml, { headers: { "Content-Type": "application/xml" } });
}
