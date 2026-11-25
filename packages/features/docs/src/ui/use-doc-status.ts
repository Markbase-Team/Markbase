"use client";

// A document's status (doc types, layer 1): its core fields, the warnings
// about them, how trusted its current text is and whether a review is due,
// asked of GET /docs/:id/status — the same call an agent's `docs_docStatus`
// tool makes. Asked again a moment after the document changes, so a
// confirmation ends on screen as soon as the text it confirmed is edited.

import { useCallback, useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import type { Confirmation, DocStatusReport } from "@markbase/shared/docs";
import { useDocFetch } from "./doc-client";
import { isLocalDocId } from "./local-file-crdt";

export type DocStatusAnswer = Omit<DocStatusReport, "current_confirmations"> & {
  current_confirmations: (Confirmation & { name: string })[];
};

/** Longer than the editor's save pause, so the answer includes what was just typed. */
const REFRESH_MS = 1_500;

export function useDocStatus(docId: string, editor: Editor) {
  const docFetch = useDocFetch();
  const [status, setStatus] = useState<DocStatusAnswer | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A loose file on the desktop has no server copy to ask about.
  const available = !isLocalDocId(docId);
  const asked = useRef(0);

  const ask = useCallback(async () => {
    if (!available) return;
    const mine = ++asked.current;
    try {
      const res = await docFetch(`/api/v1/docs/${docId}/status`, { cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json()) as DocStatusAnswer;
      if (mine === asked.current) setStatus(body);
    } catch {
      // Offline: keep showing the last answer.
    }
  }, [available, docFetch, docId]);

  useEffect(() => {
    setStatus(null);
    void ask();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onUpdate = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void ask(), REFRESH_MS);
    };
    editor.on("update", onUpdate);
    return () => {
      clearTimeout(timer);
      editor.off("update", onUpdate);
    };
  }, [ask, editor]);

  const confirm = useCallback(async () => {
    setConfirming(true);
    setError(null);
    try {
      const res = await docFetch(`/api/v1/docs/${docId}/verify`, { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Couldn't confirm the document.");
        return;
      }
      await ask();
    } catch {
      setError("Couldn't reach Markbase to confirm the document.");
    } finally {
      setConfirming(false);
    }
  }, [ask, docFetch, docId]);

  return { available, status, confirm, confirming, error };
}
