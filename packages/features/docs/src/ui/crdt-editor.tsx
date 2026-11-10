"use client";

// Standalone CRDT editor surface (roadmap F1, browser half) — a bare TipTap
// editor bound to the CRDT via useCrdtSync. Used by the
// /documents/[id]/crdt route to exercise the CRDT path without the production
// editor's chrome. The production DocEditor uses the same hook.

import { useRef } from "react";
import type * as Y from "yjs";
import { EditorContent, useEditor } from "@tiptap/react";
import { docExtensions, emptyDoc, type DocJSON } from "@markbase/docs";
import { useCrdtSync } from "./use-crdt-sync";
import { YUndo } from "./y-undo";

export function CrdtEditor({
  docId,
  initialMarkdown = "",
}: {
  docId: string;
  initialMarkdown?: string;
}) {
  const undoRef = useRef<Y.UndoManager | null>(null);
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      ...docExtensions,
      // configure() STORES this getter; ProseMirror calls it on ⌘Z, long after
      // this render. Reading the ref is the point — the editor is built once and
      // must not capture the render that built it.
      // eslint-disable-next-line react-hooks/refs
      YUndo.configure({ getManager: () => undoRef.current }),
    ],
    content: emptyDoc().toJSON() as DocJSON,
  });
  const status = useCrdtSync(
    editor,
    docId,
    initialMarkdown,
    true,
    undefined,
    0,
    undefined,
    undefined,
    undoRef
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="text-xs text-[var(--text-muted)]" data-testid="crdt-status">
        {status === "live" ? "● live" : "connecting…"}
      </div>
      <div className="rounded-lg border border-[var(--border-subtle)] p-4">
        <EditorContent editor={editor} data-testid="crdt-editor" />
      </div>
    </div>
  );
}
