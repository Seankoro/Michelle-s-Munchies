import { withSentryConfig } from "@sentry/nextjs";

// next/image needs the Supabase Storage host allow-listed. Derive it from the
// same env var the CSP uses so pointing at a new Supabase project needs no
// code change here.
const supabaseHost = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname
  : "ddwesutmtlytbcluqcuc.supabase.co";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // There is a stray package-lock.json and node_modules directly in the home
  // folder, so Next guessed C:\Users\seani was the workspace root and warned
  // about it on every build. Left alone, the step that works out which files to
  // ship walks from there, which means the whole home folder rather than this
  // project. Point it at the project and it only ever looks here.
  outputFileTracingRoot: import.meta.dirname,
  images: {
    // Product images will be served from Supabase Storage.
    remotePatterns: [{ protocol: "https", hostname: supabaseHost }],
  },
  // Security headers applied to every route. The CSP itself moved to
  // src/middleware.ts, which issues a per-request script nonce instead of the
  // old blanket 'unsafe-inline'.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ],
      },
    ];
  },
  // Stop the dev file-watcher from reacting to tool-written artifacts
  // (Playwright snapshots/console logs and screenshots), which otherwise
  // triggers an endless recompile loop.
  webpack: (config, { dev }) => {
    if (dev) {
      config.watchOptions = {
        ...config.watchOptions,
        ignored: [
          "**/node_modules/**",
          "**/.next/**",
          "**/.git/**",
          "**/.playwright-mcp/**",
          "**/*.png",
        ],
      };
    }
    return config;
  },
};

// Error reporting only. Source-map upload is off until a Sentry auth token is
// configured, so builds need no Sentry account access.
export default withSentryConfig(nextConfig, {
  silent: true,
  telemetry: false,
  sourcemaps: { disable: true },
  disableLogger: true,
});
