"use client";

// A document's analytics, read from its CRDT: the agents' read tally and the
// line credit (@markbase/docs, analytics.ts). Like the history panel, this
// joins the document the editor already has open rather than fetching — the
// numbers ride the same channel the content does, so a read recorded on
// another machine, or a version cut in another tab, shows up by itself.

import { useEffect, useState } from "react";
import { lineCredit, listAgentReads, watchAgentReads, type AgentReadTally, type LineCredit } from "@markbase/docs";
import { docCrdtPool } from "./doc-crdt-pool";
import { useDocsPorts } from "./ports";

export interface DocAnalytics {
  reads: AgentReadTally[];
  /** Null until the document is open, or when its history cannot be read. */
  credit: LineCredit | null;
  loading: boolean;
}

/** How long typing must pause before the line credit is worked out again. */
const SETTLE_MS = 600;

/** Pass `enabled: false` (panel closed) to avoid opening the doc at all. */
export function useDocAnalytics(docId: string, enabled: boolean): DocAnalytics {
  const [reads, setReads] = useState<AgentReadTally[]>([]);
  const [credit, setCredit] = useState<LineCredit | null>(null);
  const [loading, setLoading] = useState(enabled);
  // The panel can mount before the editor has opened the document; retry
  // briefly rather than show nothing forever.
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled || !loading) return;
    const t = setTimeout(() => setAttempt((n) => n + 1), 300);
    return () => clearTimeout(t);
  }, [enabled, loading, attempt]);

  const ports = useDocsPorts();
  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let joined = false;
    let detach = (): void => {};

    void (async () => {
      setLoading(true);
      // `join`, never `acquire`: opening the document belongs to the editor.
      const pending = docCrdtPool(ports).join(docId);
      if (!pending) return; // not open yet — the retry above comes back
      const entry = await pending;
      if (disposed) {
        docCrdtPool(ports).release(docId);
        return;
      }
      joined = true;
      const ydoc = entry.doc;

      const refreshReads = (): void => setReads(listAgentReads(ydoc));
      const refreshCredit = (): void => {
        try {
          setCredit(lineCredit(ydoc));
        } catch {
          setCredit(null); // a version that cannot be rebuilt: say nothing rather than guess
        }
      };
      // Credit follows the text and the versions; work it out once typing pauses.
      let timer: ReturnType<typeof setTimeout> | undefined;
      const onUpdate = (): void => {
        clearTimeout(timer);
        timer = setTimeout(refreshCredit, SETTLE_MS);
      };
      ydoc.on("update", onUpdate);
      const stopReads = watchAgentReads(ydoc, refreshReads);
      detach = () => {
        clearTimeout(timer);
        ydoc.off("update", onUpdate);
        stopReads();
      };

      refreshReads();
      refreshCredit();
      setLoading(false);
    })();

    return () => {
      disposed = true;
      detach();
      if (joined) docCrdtPool(ports).release(docId);
    };
  }, [docId, enabled, attempt, ports]);

  return { reads, credit, loading };
}
