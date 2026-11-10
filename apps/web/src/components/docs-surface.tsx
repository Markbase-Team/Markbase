"use client";

import { DocsShell, browserDocsPorts, type DocsRouting } from "@markbase/docs/ui";

/**
 * Where this shell puts documents, bound to the docs surface.
 *
 * The package asks for both directions — it writes a URL when you open a tab
 * and reads one back on load and on Back — and knows neither, so a desktop
 * shell routing on other paths supplies its own pair and reuses the surface
 * unchanged.
 *
 * This lives in a Client Component, and that is the whole reason the file
 * exists. `DocsRouting` is two METHODS, `DocsShell` is a Client Component, and
 * functions cannot cross the server/client boundary — React refuses with
 * "Functions cannot be passed directly to Client Components". The layout above
 * is an async Server Component (it reads the session), so building the object
 * there and passing it down threw on every render of /dashboard/documents.
 *
 * Declared here instead, it never crosses the boundary: the layout passes only
 * strings, and the routing object is created on the client where it is used.
 */
const routing: DocsRouting = {
  docUrl(docId, vault) {
    const q = vault ? `?vault=${encodeURIComponent(vault)}` : "";
    return docId ? `/dashboard/documents/${docId}${q}` : `/dashboard/documents${q}`;
  },
  idFromPath(path) {
    const parts = path.split("/").filter(Boolean);
    return parts[0] === "dashboard" && parts[1] === "documents" && parts[2]
      ? parts[2]
      : null;
  },
};

export function DocsSurface({
  userId,
  userName,
  children,
}: {
  userId: string | null;
  userName: string;
  children: React.ReactNode;
}) {
  return (
    // A browser: links open in a new tab, and there are no local vaults, no
    // agent, no snapshots served from disk. The desktop shell supplies all of
    // those from its bridge.
    <DocsShell userId={userId} userName={userName} routing={routing} ports={browserDocsPorts}>
      {children}
    </DocsShell>
  );
}
