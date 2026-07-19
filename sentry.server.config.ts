import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,
  // Error tracking only, no performance tracing, to stay well inside the free tier.
  tracesSampleRate: 0,
  enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
});
