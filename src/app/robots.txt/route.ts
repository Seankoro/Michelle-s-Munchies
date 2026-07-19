// Served as a plain route instead of the robots.ts file convention because
// Next's metadata-route loader breaks on this project's apostrophe path
// ("Michelle's Munchies"), the same bug that forced og.png into public/.

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

// Private and transactional surfaces stay out of search results.
const DISALLOW = [
  "/admin",
  "/api/",
  "/account",
  "/auth/",
  "/cart",
  "/checkout",
  "/track",
  "/unsubscribe",
  "/wishlist/share/",
];

export function GET() {
  const body = [
    "User-Agent: *",
    "Allow: /",
    ...DISALLOW.map((path) => `Disallow: ${path}`),
    "",
    `Sitemap: ${SITE_URL}/sitemap.xml`,
    "",
  ].join("\n");
  return new Response(body, { headers: { "Content-Type": "text/plain" } });
}
