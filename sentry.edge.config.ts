import * as Sentry from "@sentry/nextjs";

// The middleware (admin/account guards) runs on the edge runtime.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 0,
  enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
});
