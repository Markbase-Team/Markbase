"use client"; // Error boundaries must be Client Components.

import { useEffect } from "react";
import { Button } from "@markbase/ui/button";

/**
 * What a failed render says instead of nothing.
 *
 * Next's built-in fallback is the words "This page couldn't load" and nothing
 * else — no message, no identifier, no way back. A signed-in person hitting a
 * server error on /dashboard/documents saw exactly that, and diagnosing it
 * meant going to find the terminal the dev server was running in. There was no
 * error boundary anywhere in this app, so that was the experience for every
 * failure in it.
 *
 * Placed at the ROOT of app/, not under dashboard/, and that is not a
 * preference: `error.tsx` does not wrap the `layout.tsx` beside it. A boundary
 * at app/dashboard/ would miss anything thrown by app/dashboard/layout.tsx —
 * the sidebar, the feature registry, the session read — which is most of what
 * can fail up there. A parent segment catches its children's layouts; this is
 * the parent of every page except the root layout itself (see global-error).
 *
 * `error.message` is the real message in development and a generic one in
 * production, where Next redacts it and gives `digest` instead to match the
 * server log. Both are shown, because the one that is useful differs by
 * environment and neither is worth hiding from whoever is looking.
 *
 * What this still cannot catch, so nobody goes looking for it here:
 *   • anything thrown in proxy.ts — the proxy runs before routing, so there is
 *     no page and no boundary yet. A proxy that throws is a bare 500.
 *   • a module that throws while being EVALUATED rather than rendered (a
 *     top-level call in the root layout's import graph). global-error replaces
 *     a root layout that failed to render, not one that failed to load.
 * Both were reachable in a container with no Supabase env, which is how they
 * came to be listed here.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The browser console is where someone looks first, and a boundary that
    // swallows the error entirely is worse than the default it replaced.
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-svh flex-1 items-center justify-center px-6 py-12">
      <div className="w-full max-w-md">
        <h1 className="text-lg font-semibold">This page didn&apos;t load</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something failed while rendering it. Your work is not affected.
        </p>

        {error.message && (
          <pre className="mt-4 overflow-x-auto rounded-lg border bg-muted/40 p-3 text-left text-xs whitespace-pre-wrap">
            {error.message}
          </pre>
        )}
        {error.digest && (
          <p className="mt-2 font-mono text-xs text-muted-foreground">
            digest {error.digest}
          </p>
        )}

        <div className="mt-6 flex gap-2">
          <Button onClick={reset}>Try again</Button>
          <Button variant="outline" onClick={() => window.location.reload()}>
            Reload
          </Button>
        </div>
      </div>
    </main>
  );
}
