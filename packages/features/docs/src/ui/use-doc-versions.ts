"use client";

// The history of a document, read from the CRDT (roadmap B3).
//
// Versions live in a Y.Array inside the document's own Y.Doc, so this opens the
// document and reads them. That sounds wasteful next to the editor, which already
// has it open — but it's the point of the model: the CRDT is the shared truth, and
// any surface may open it and converge. The alternative is threading a Y.Doc
// through four components that have no other reason to know about Yjs.
//
// It replaces a history that read docs.steps — the op-log of the /steps editor,
// which CRDT edits never write, so history silently froze at the pivot.

import { useEffect, useState } from "react";
import {
  listVersions,
  versionContent,
  versionDiff,
  restoreVersion,
  markdownToDoc,
  type DiffSegment,
  type DocJSON,
  type VersionMeta,
} from "@markbase/docs";
import * as Y from "yjs";
import { docCrdtPool } from "./doc-crdt-pool";
import { useDocsPorts } from "./ports";

export interface DocVersions {
  versions: VersionMeta[];
  /** The markdown as of a version — reconstructed on demand, never up front. */
  contentAt: (index: number) => string | null;
  /** What changed in a version, as coloured segments. Reconstructs, so only on click. */
  diffAt: (index: number) => DiffSegment[] | null;
  /** The reconstructed document, for reading a whole version. */
  docJsonAt: (index: number) => DocJSON | null;
  /**
   * Make a version current, as a new edit.
   *
   * This writes to the panel’s own Y.Doc — which is the SAME document, so the
   * change reaches the editor through the CRDT with no callback, no refetch and
   * no prop passing. That is the model paying for itself.
   */
  restore: (index: number) => boolean;
  loading: boolean;
}

/** Pass `enabled: false` (panel closed) to avoid opening the doc at all. */
export function useDocVersions(docId: string, enabled: boolean): DocVersions {
  const [versions, setVersions] = useState<VersionMeta[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [doc, setDoc] = useState<Y.Doc | null>(null);
  // The panel can mount before the editor has opened the document; retry briefly
  // rather than show an empty history forever.
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
      // Inside the async body: a setState reached synchronously from an effect
      // costs a render pass before anything paints.
      setLoading(true);
      // `join`, never `acquire`: opening the document belongs to the editor,
      // which is the only caller holding the seed markdown. Joining without one
      // could seed an empty CRDT over a doc whose content lives in its row.
      const pending = docCrdtPool(ports).join(docId);
      if (!pending) return; // not open yet — the retry above comes back
      const entry = await pending;
      if (disposed) {
        docCrdtPool(ports).release(docId);
        return;
      }
      joined = true;
      const ydoc = entry.doc;

      const refresh = (): void => setVersions(listVersions(ydoc));
      // Observe, so a version recorded in this tab (or another device) appears
      // without a refresh — the same channel the content already rides.
      const arr = ydoc.getArray("versions");
      arr.observe(refresh);
      detach = () => arr.unobserve(refresh);

      refresh();
      setDoc(ydoc);
      setLoading(false);
    })();

    return () => {
      disposed = true;
      detach();
      // Release, don't close: the pool owns this doc, and the editor is still on it.
      if (joined) docCrdtPool(ports).release(docId);
      setDoc(null);
    };
  }, [docId, enabled, attempt, ports]);

  return {
    versions,
    loading,
    contentAt: (index: number): string | null => {
      if (!doc) return null;
      try {
        return versionContent(doc, index);
      } catch {
        // A corrupt entry shouldn't take the panel down with it.
        return null;
      }
    },
    diffAt: (index: number): DiffSegment[] | null => {
      if (!doc) return null;
      try {
        return versionDiff(doc, index);
      } catch {
        return null;
      }
    },
    docJsonAt: (index: number): DocJSON | null => {
      if (!doc) return null;
      try {
        return markdownToDoc(versionContent(doc, index)).toJSON() as DocJSON;
      } catch {
        return null;
      }
    },
    restore: (index: number): boolean => {
      if (!doc) return false;
      try {
        restoreVersion(doc, index);
        return true;
      } catch {
        return false;
      }
    },
  };
}
