"use client";

// A document's comments, read from and written to the CRDT (roadmap B1).
//
// Comments live in a Y.Array in the document's own Y.Doc. Because they're in the
// CRDT they sync over the one channel, survive edits (relative-position anchors),
// and converge when two people comment at once.
//
// It reads the doc the EDITOR already has open, from the warm pool. It used to
// build a second Y.Doc and open its own SyncSession straight to Supabase — which
// re-downloaded the whole document over the network, and held a duplicate replica
// and a second Realtime subscription, for a document sitting in memory (and, on
// the desktop, on disk). Comments are local-first for the same reason the text
// is: they are in the same snapshot.
//
// This replaces the Postgres-backed comment path for CRDT-mode documents, whose
// anchors pinned to a quoted string and were re-found by search — fragile under
// edits and duplicates.

import { useEffect, useMemo, useRef, useState } from "react";
import * as Y from "yjs";
import {
  addComment,
  addReply,
  resolveComment,
  deleteComment,
  listCommentThreads,
  offsetForQuote,
  type CommentView,
} from "@markbase/docs";
import { docCrdtPool } from "./doc-crdt-pool";
import { useDocsPorts } from "./ports";
import { useLatest } from "@markbase/ui/latest-ref";

export interface DocComments {
  threads: CommentView[];
  loading: boolean;
  /** Comment on a selection. `quote` is the selected text; we anchor it in source. */
  add: (quote: string, body: string) => boolean;
  reply: (parentId: string, body: string) => void;
  resolve: (rootId: string, resolved: boolean) => void;
  remove: (id: string) => void;
}

const author = (name: string, id: string | null) => ({ name, id });

export function useDocComments(
  docId: string,
  enabled: boolean,
  user: { name: string; id: string | null }
): DocComments {
  const [threads, setThreads] = useState<CommentView[]>([]);
  const [loading, setLoading] = useState(enabled);
  // The panel can mount before the editor has opened the document. Retry briefly
  // rather than show an empty thread list forever.
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled || !loading) return;
    const t = setTimeout(() => setAttempt((n) => n + 1), 300);
    return () => clearTimeout(t);
  }, [enabled, loading, attempt]);
  const docRef = useRef<Y.Doc | null>(null);
  const userRef = useLatest(user);
  const ports = useDocsPorts();

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let joined = false;
    let detach = (): void => {};

    void (async () => {
      // Inside the async body, not beside it: a setState run synchronously while
      // effects are flushing forces a second render pass before anything paints,
      // for a spinner nobody has seen yet.
      setLoading(true);
      // `join`, never `acquire`: the editor owns opening this document, because
      // only it has the seed markdown. Joining without one could seed an empty
      // CRDT over a doc whose content still lives in its row.
      const pending = docCrdtPool(ports).join(docId);
      if (!pending) return; // the editor hasn't opened it yet — the retry below
      const entry = await pending;
      if (disposed) {
        docCrdtPool(ports).release(docId);
        return;
      }
      joined = true;
      const ydoc = entry.doc;
      docRef.current = ydoc;

      const refresh = (): void => setThreads(listCommentThreads(ydoc));
      // Observe DEEP: a comment is a Y.Map, so a resolve (a field edit) is a change
      // inside the array's items, which a shallow observe misses.
      const arr = ydoc.getArray("comments");
      arr.observeDeep(refresh);
      detach = () => arr.unobserveDeep(refresh);

      refresh();
      setLoading(false);
    })();

    return () => {
      disposed = true;
      detach();
      // Release rather than close: the pool owns this doc's lifetime, and the
      // editor is very likely still bound to it.
      if (joined) docCrdtPool(ports).release(docId);
      docRef.current = null;
    };
  }, [docId, enabled, attempt, ports]);

  return useMemo(
    () => ({
      threads,
      loading,
      add: (quote: string, body: string): boolean => {
        const doc = docRef.current;
        if (!doc || !quote.trim() || !body.trim()) return false;
        // The selection came from the EDITOR (ProseMirror positions); the anchor
        // lives in the markdown SOURCE, so bridge by the quoted text.
        const at = offsetForQuote(doc.getText("source").toString(), quote);
        if (!at) return false; // the quote isn't in the source (stale selection)
        addComment(doc, {
          ...at,
          body: body.trim(),
          author: author(userRef.current.name, userRef.current.id),
        });
        return true;
      },
      reply: (parentId: string, body: string): void => {
        const doc = docRef.current;
        if (doc && body.trim()) {
          addReply(doc, { parentId, body: body.trim(), author: author(userRef.current.name, userRef.current.id) });
        }
      },
      resolve: (rootId: string, resolved: boolean): void => {
        if (docRef.current) resolveComment(docRef.current, rootId, resolved);
      },
      remove: (id: string): void => {
        if (docRef.current) deleteComment(docRef.current, id);
      },
    }),
    [threads, loading, userRef]
  );
}
