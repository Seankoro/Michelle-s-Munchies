import * as Sentry from "@sentry/nextjs";

/** Boots Sentry in the right runtime when the server starts. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}

/** Reports errors from nested React Server Components and server actions. */
export const onRequestError = Sentry.captureRequestError;
