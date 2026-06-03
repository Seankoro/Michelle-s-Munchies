/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    // Product images will be served from Supabase Storage.
    remotePatterns: [
      { protocol: "https", hostname: "ddwesutmtlytbcluqcuc.supabase.co" },
    ],
  },
  // Security headers applied to every route. The CSP is a touch looser in dev
  // (Next's HMR needs eval + websockets); production tightens those.
  async headers() {
    const isDev = process.env.NODE_ENV !== "production";
    const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
    const csp = [
      "default-src 'self'",
      "base-uri 'self'",
      `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
      "style-src 'self' 'unsafe-inline'",
      `img-src 'self' data: blob: ${supabase}`.trim(),
      "font-src 'self' data:",
      `connect-src 'self' ${supabase} https://api.stripe.com${isDev ? " ws: wss:" : ""}`.trim(),
      "frame-src https://js.stripe.com https://checkout.stripe.com https://accounts.google.com",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "object-src 'none'",
    ].join("; ");
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
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

export default nextConfig;
