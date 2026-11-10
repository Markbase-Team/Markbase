"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * Where the documents surface lives in whatever is routing the app.
 *
 * The navigation port (@markbase/ui/navigation) took the *framework* out of
 * this package — push and pathname no longer come from `next/navigation`. This
 * takes the *URL scheme* out too, which the port alone left behind: the shell
 * still built `/dashboard/documents/${id}` inside the package, so a desktop
 * shell routing on different paths would have been silently wrong.
 *
 * Both directions, because the surface needs both. It writes a URL when you
 * open a tab, and reads one back on load and on Back — one without the other
 * leaves half the coupling in place.
 */
export interface DocsRouting {
  /** Where a document lives, optionally scoped to a vault. */
  docUrl(docId: string | null, vault: string | null): string;
  /** The document id in a path this shell produced, or null for the index. */
  idFromPath(path: string): string | null;
}

const DocsRoutingContext = createContext<DocsRouting | null>(null);

export function DocsRoutingProvider({
  value,
  children,
}: {
  value: DocsRouting;
  children: ReactNode;
}) {
  return (
    <DocsRoutingContext.Provider value={value}>
      {children}
    </DocsRoutingContext.Provider>
  );
}

/** The host's document URLs. Throws when no shell supplied them. */
export function useDocsRouting(): DocsRouting {
  const routing = useContext(DocsRoutingContext);
  if (!routing) {
    throw new Error(
      "No DocsRoutingProvider above this component. A shell supplies it to " +
        "DocsShell — see apps/web's documents layout."
    );
  }
  return routing;
}
