"use client"; // Error boundaries must be Client Components.

import { useEffect } from "react";

/**
 * The last resort: the root layout itself failed.
 *
 * When this renders, app/layout.tsx did not, so this file REPLACES it and has
 * to bring its own <html> and <body>. It also cannot rely on anything the
 * layout set up — no font variable, no Toaster — so the styling here is
 * deliberately self-contained rather than reaching for the design tokens,
 * which arrive through a stylesheet the failed layout was importing.
 *
 * Nothing in the app should normally reach this. It exists because the
 * alternative, when it does happen, is a blank page.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
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
          padding: "2rem",
          colorScheme: "light dark",
          font: '15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        }}
      >
        <div style={{ maxWidth: "28rem", width: "100%" }}>
          <h1 style={{ fontSize: "1.125rem", fontWeight: 600, margin: 0 }}>
            Markbase didn&apos;t load
          </h1>
          <p style={{ opacity: 0.7, fontSize: ".875rem" }}>
            The application shell failed to render.
          </p>
          {error.message && (
            <pre
              style={{
                whiteSpace: "pre-wrap",
                fontSize: ".75rem",
                padding: ".75rem",
                borderRadius: ".5rem",
                background: "rgba(127,127,127,.15)",
                overflowX: "auto",
              }}
            >
              {error.message}
            </pre>
          )}
          {error.digest && (
            <p style={{ fontSize: ".75rem", opacity: 0.7 }}>digest {error.digest}</p>
          )}
          <button
            onClick={reset}
            style={{
              marginTop: "1rem",
              padding: ".5rem 1rem",
              borderRadius: ".5rem",
              border: "1px solid rgba(127,127,127,.4)",
              background: "transparent",
              font: "inherit",
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
