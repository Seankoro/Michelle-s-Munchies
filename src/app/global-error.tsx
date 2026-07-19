"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

/**
 * Last-resort error screen when the root layout itself crashes. Styled inline
 * because globals.css is not available here.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#fff7f9",
          color: "#3d2823",
          fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
          textAlign: "center",
        }}
      >
        <div style={{ padding: "4rem 1.5rem" }}>
          <p style={{ fontSize: "3rem", margin: 0 }} aria-hidden="true">
            🎀
          </p>
          <h1 style={{ margin: "1rem 0 0.5rem" }}>Something went wrong</h1>
          <p style={{ color: "#7c665f", margin: 0 }}>
            Sorry about that. A refresh usually fixes it, and we&rsquo;ve been notified.
          </p>
          <button
            onClick={reset}
            style={{
              marginTop: "1.5rem",
              border: "none",
              borderRadius: "999px",
              background: "#bc4a6a",
              color: "#fff",
              fontWeight: 700,
              padding: "0.75rem 1.75rem",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
