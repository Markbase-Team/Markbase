"use client";

import { useEffect, useRef, useState } from "react";
import { EditorState } from "@tiptap/pm/state";
import { EditorView } from "@tiptap/pm/view";
import { Node } from "@tiptap/pm/model";
import { ArrowLeft, GitCompare, Loader2, RotateCcw } from "lucide-react";
import { docSchema, type DiffSegment, type DocJSON } from "@markbase/docs";
import { DOC_SURFACE_CLASS } from "./doc-surface";
import "prosemirror-view/style/prosemirror.css";
import "./tiptap.css";

// Viewing a past version in the main area, in place of the editor.
//
// Presentational on purpose: it takes the reconstructed doc and diff as PROPS and
// owns none of it. Two engines feed it — the /steps op-log fetches them from the
// API, the CRDT reconstructs them from a Y.Array — and neither should have to
// carry its own copy of this chrome. (It's also the honest fix for having already
// duplicated the diff colours into the history panel once.)

/** The word-diff, coloured. The one place "added"/"removed" gets its look. */
export function DiffBody({ diff }: { diff: DiffSegment[] | null }) {
  if (diff === null) return <span className="text-muted-foreground">Loading…</span>;
  if (diff.length === 0) return <span className="text-muted-foreground">No textual change.</span>;
  return (
    <>
      {diff.map((seg, i) => (
        <span
          key={i}
          data-added={seg.added ? "1" : undefined}
          data-removed={seg.removed ? "1" : undefined}
          className={
            seg.added
              ? "rounded bg-emerald-200 text-emerald-900 dark:bg-emerald-500/30 dark:text-emerald-200"
              : seg.removed
                ? "rounded bg-red-200 text-red-900 line-through dark:bg-red-500/30 dark:text-red-200"
                : "text-muted-foreground"
          }
        >
          {seg.value}
        </span>
      ))}
    </>
  );
}

export function VersionPreview({
  title,
  diff,
  docJson,
  canRestore,
  onBack,
  onRestore,
}: {
  /** Names the version being viewed, e.g. "Version 3". */
  title: string;
  diff: DiffSegment[] | null;
  /** The reconstructed document, for "show full document". */
  docJson: DocJSON | null;
  canRestore: boolean;
  onBack: () => void;
  onRestore: () => Promise<void>;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  // Default to the diff: clicking a version asks "what changed?", not "show me
  // the whole document".
  const [mode, setMode] = useState<"doc" | "diff">("diff");
  const [restoring, setRestoring] = useState(false);

  // Read-only ProseMirror for the full-document view.
  useEffect(() => {
    if (mode !== "doc" || !docJson || !hostRef.current) return;
    const view = new EditorView(hostRef.current, {
      state: EditorState.create({ doc: Node.fromJSON(docSchema, docJson) }),
      editable: () => false,
    });
    return () => view.destroy();
  }, [docJson, mode]);

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="version-preview">
      <div className="mb-2 flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs dark:border-amber-800 dark:bg-amber-950/30">
        <span className="font-medium">
          {mode === "diff" ? `${title} — changes vs. the previous version` : `${title} (read-only)`}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onBack}
            data-testid="preview-back"
            className="inline-flex items-center gap-1 rounded border px-2 py-1 hover:bg-muted"
          >
            <ArrowLeft className="size-3.5" />
            Back to latest
          </button>
          <button
            type="button"
            onClick={() => setMode((m) => (m === "diff" ? "doc" : "diff"))}
            className="inline-flex items-center gap-1 rounded border px-2 py-1 hover:bg-muted"
          >
            <GitCompare className="size-3.5" />
            {mode === "diff" ? "Show full document" : "Show changes"}
          </button>
          {canRestore && (
            <button
              type="button"
              data-testid="preview-restore"
              onClick={() => {
                setRestoring(true);
                void onRestore().finally(() => setRestoring(false));
              }}
              disabled={restoring}
              className="inline-flex items-center gap-1 rounded-full bg-[#e5ff6e] px-3 py-1 font-semibold text-neutral-900 disabled:opacity-60"
            >
              {restoring ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RotateCcw className="size-3.5" />
              )}
              Restore this version
            </button>
          )}
        </div>
      </div>

      {mode === "diff" ? (
        <div
          data-testid="preview-diff"
          className="min-h-0 flex-1 overflow-y-auto rounded-lg border bg-background p-4 text-sm leading-relaxed break-words whitespace-pre-wrap"
        >
          <DiffBody diff={diff} />
        </div>
      ) : (
        <div ref={hostRef} className={DOC_SURFACE_CLASS} />
      )}
    </div>
  );
}
