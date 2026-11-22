"use client";

// A document's analytics: the agents' read tally and the line credit
// (@markbase/docs, analytics.ts), asked of GET /docs/:id/analytics — the same
// call an agent's `docs_analytics` tool makes, so the panel and the tool
// cannot disagree about what the numbers are.
//
// The document the editor has open is joined only to hear that it changed:
// every change (typed here, or arriving from another machine) asks the
// endpoint again once it has had time to reach the server. Two cases are
// worked out from that open document instead, with the very function the
// endpoint runs (`docAnalytics`):
//
//   - a loose file in the desktop's file window, which the server has never
//     heard of;
//   - a request that fails (offline on the desktop), so the panel still says
//     something rather than nothing.

import { useEffect, useState } from "react";
import { docAnalytics, watchAgentReads, type DocAnalyticsReport } from "@markbase/shared/docs";
import type * as Y from "yjs";
import { useDocFetch } from "./doc-client";
import { docCrdtPool } from "./doc-crdt-pool";
import { isLocalDocId } from "./local-file-crdt";
import { useDocsPorts } from "./ports";

export interface DocAnalyticsState {
  /** Null until the first answer. */
  analytics: DocAnalyticsReport | null;
  loading: boolean;
}

/**
 * How long after the last change the endpoint is asked again. Longer than the
 * pause the editor waits before saving the document (transport.ts), so the
 * answer includes what was just typed.
 */
const REFRESH_MS = 1_500;
/**
 * And once more, later: a save can take longer than that to land — a slow
 * connection, or the desktop, which uploads on its own schedule.
 */
const RECHECK_MS = 6_000;
/** A loose file is worked out here; that only waits for typing to pause. */
const SETTLE_MS = 600;
/** How often, and how many times, to look for the editor's open document. */
const JOIN_RETRY_MS = 300;
const JOIN_TRIES = 20;

/** Pass `enabled: false` (panel closed) to ask for nothing at all. */
export function useDocAnalytics(docId: string, enabled: boolean): DocAnalyticsState {
  const [analytics, setAnalytics] = useState<DocAnalyticsReport | null>(null);
  const [loading, setLoading] = useState(enabled);
  const ports = useDocsPorts();
  const docFetch = useDocFetch();

  useEffect(() => {
    if (!enabled) return;
    const local = isLocalDocId(docId);
    let disposed = false;
    let ydoc: Y.Doc | null = null;
    let detach = (): void => {};
    let joinTimer: ReturnType<typeof setTimeout> | undefined;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    let recheckTimer: ReturnType<typeof setTimeout> | undefined;
    // Answers can come back out of order; only the latest request's is shown.
    let asked = 0;
    // The last request failed, so what is shown comes from the open document.
    let unreachable = false;

    const show = (next: DocAnalyticsReport): void => {
      if (disposed) return;
      setAnalytics(next);
      setLoading(false);
    };
    const fromOpenDoc = (): void => {
      if (ydoc) show(docAnalytics(ydoc));
    };
    const ask = async (): Promise<void> => {
      const mine = ++asked;
      try {
        const res = await docFetch(`/api/v1/docs/${docId}/analytics`, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as DocAnalyticsReport;
        if (mine !== asked) return;
        unreachable = false;
        show(body);
      } catch {
        if (disposed || mine !== asked) return;
        // Unreachable: what this machine holds, worked out the same way.
        unreachable = true;
        if (ydoc) fromOpenDoc();
        else setLoading(false);
      }
    };
    const refresh = (): void => {
      clearTimeout(refreshTimer);
      clearTimeout(recheckTimer);
      if (local) {
        refreshTimer = setTimeout(fromOpenDoc, SETTLE_MS);
        return;
      }
      refreshTimer = setTimeout(() => void ask(), REFRESH_MS);
      recheckTimer = setTimeout(() => void ask(), RECHECK_MS);
    };

    // The panel can mount before the editor has opened the document; look
    // again briefly. `join`, never `acquire`: opening belongs to the editor.
    const join = async (triesLeft: number): Promise<void> => {
      const pending = docCrdtPool(ports).join(docId);
      if (!pending) {
        if (triesLeft > 0) joinTimer = setTimeout(() => void join(triesLeft - 1), JOIN_RETRY_MS);
        else if (local) setLoading(false);
        return;
      }
      let entry;
      try {
        entry = await pending;
      } catch {
        docCrdtPool(ports).release(docId);
        if (local && !disposed) setLoading(false);
        return;
      }
      if (disposed) {
        docCrdtPool(ports).release(docId);
        return;
      }
      const joined = entry.doc;
      ydoc = joined;
      joined.on("update", refresh);
      const stopReads = watchAgentReads(joined, refresh);
      detach = () => {
        joined.off("update", refresh);
        stopReads();
        docCrdtPool(ports).release(docId);
      };
      if (local || unreachable) fromOpenDoc();
    };

    if (!local) void ask();
    void join(JOIN_TRIES);

    return () => {
      disposed = true;
      clearTimeout(joinTimer);
      clearTimeout(refreshTimer);
      clearTimeout(recheckTimer);
      detach();
    };
  }, [docId, enabled, ports, docFetch]);

  return { analytics, loading };
}
