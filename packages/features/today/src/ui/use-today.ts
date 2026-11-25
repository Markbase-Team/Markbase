"use client";

// What Today shows: the built-in view `today` (GET /api/v1/docs/views,
// docs_queryView, the same call an agent's tool makes), in the viewer's time
// zone. Finishing a task is setting its `done` property (docs_setProperty):
// it leaves the list at once, and comes back with the reason if that fails.

import { useCallback, useEffect, useState } from "react";
import { api } from "@markbase/shared/api-client";
import type { ViewResult } from "@markbase/shared/docs/view-types";

const BASE = "/api/v1/docs";

/** The viewer's time zone, as the browser knows it. */
function viewerTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** The view without one document. */
function without(view: ViewResult, id: string): ViewResult {
  return {
    ...view,
    rows: view.rows.filter((r) => r.id !== id),
    groups: view.groups
      ?.map((g) => ({ ...g, rows: g.rows.filter((r) => r.id !== id) }))
      .filter((g) => g.rows.length > 0),
  };
}

export function useToday() {
  const [view, setView] = useState<ViewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setView(await api.json<ViewResult>(`${BASE}/views?view=today&tz=${encodeURIComponent(viewerTimeZone())}`));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load your tasks.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** Mark a task done. Resolves to the reason it couldn't be, or null. */
  const finish = useCallback(
    async (id: string): Promise<string | null> => {
      const before = view;
      if (before) setView(without(before, id));
      try {
        const res = await api.request(`${BASE}/${encodeURIComponent(id)}/properties`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ key: "done", value: true }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        return null;
      } catch (e) {
        if (before) setView(before);
        return e instanceof Error ? e.message : "Couldn't mark it done.";
      }
    },
    [view],
  );

  return { view, error, loading, reload: load, finish };
}
