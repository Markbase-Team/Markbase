"use client";

import { api } from "@markbase/protocol/api-client";
import { intentFromClick, type OpenIntent } from "@markbase/docs/workspace-tabs";

import { useEffect, useState } from "react";
import { FileText } from "lucide-react";
import type { DocSearchHit } from "@markbase/docs/server";

/**
 * Live results for the documentation-sidebar search. Debounced; searches title +
 * markdown content server-side (`/api/v1/docs/search`), scoped to the same vault
 * (or shared-with-me) the tree is showing. Clicking a hit opens it as a tab.
 */
export function DocSearchResults({
  query,
  vaultId,
  shared,
  onOpenDoc,
}: {
  query: string;
  vaultId: string | null;
  shared: boolean;
  onOpenDoc: (docId: string, title: string, intent: OpenIntent) => void;
}) {
  const [hits, setHits] = useState<DocSearchHit[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      // Inside the debounce, not before it: the spinner belongs to a search that
      // is actually starting, and a setState run synchronously in an effect
      // costs a render pass before anything paints.
      setLoading(true);
      const params = new URLSearchParams({ q: query });
      if (shared) params.set("scope", "shared");
      else if (vaultId) params.set("vault", vaultId);
      api.request(`/api/v1/docs/search?${params.toString()}`)
        .then((r) => r.json())
        .then((d: { hits?: DocSearchHit[] }) => {
          if (!cancelled) setHits(d.hits ?? []);
        })
        .catch(() => {})
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, vaultId, shared]);

  if (loading && hits.length === 0) {
    return <p className="px-3 py-2 text-sm text-muted-foreground">Searching…</p>;
  }
  if (hits.length === 0) {
    return (
      <p className="px-3 py-2 text-sm text-muted-foreground">
        No matches for “{query}”.
      </p>
    );
  }

  return (
    <ul className="min-h-0 flex-1 overflow-y-auto">
      {hits.map((h) => (
        <li key={h.id}>
          <button
            type="button"
            onClick={(e) => onOpenDoc(h.id, h.title || "Untitled", intentFromClick(e))}
            onMouseDown={(e) => {
              if (e.button === 1) e.preventDefault();
            }}
            onAuxClick={(e) => {
              if (e.button !== 1) return;
              e.preventDefault();
              onOpenDoc(h.id, h.title || "Untitled", "new");
            }}
            className="flex w-full flex-col gap-0.5 border-b px-3 py-2 text-left hover:bg-muted"
          >
            <span className="flex items-center gap-2">
              <FileText className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {h.title || "Untitled"}
              </span>
            </span>
            {h.snippet && (
              <span className="line-clamp-2 pl-[22px] text-xs text-muted-foreground">
                {h.snippet}
              </span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}
