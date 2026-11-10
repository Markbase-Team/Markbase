"use client";

// Binds a live TipTap editor to the CRDT model (roadmap B6 — the pivot).
//
// The editor's content becomes a projection of a Y.Text that syncs over Supabase
// (doc_crdt snapshot + Realtime deltas) — the same CRDT the worker's vault syncs,
// so a browser edit and a local file edit converge. Shared by the standalone
// CrdtEditor and the production DocEditor, so there's one wiring, not two.

import { useEffect, useRef, useState, type MutableRefObject } from "react";
import type { Editor } from "@tiptap/react";
import type * as Y from "yjs";
import {
  docJsonToMarkdown,
  EditorBinding,
  getMarkdown,
  observeMarkdown,
  checkpoint,
  shouldCheckpoint,
  listVersions,
  versionContent,
  versionCount,
  watchComments,
  docText,
  posToTextOffset,
  textOffsetToPos,
  mapSelectionThroughEdit,
  type CommentView,
  type DocJSON,
  type MarkdownLens,
} from "@markbase/docs";
import { docCrdtPool } from "./doc-crdt-pool";
import { useDocsPorts } from "./ports";
import { useLatest } from "@markbase/ui/latest-ref";

export type CrdtStatus = "off" | "connecting" | "live";

/**
 * How often to ASK whether a version is due — not how often one is taken. The
 * cadence rules (2 min idle, 10 min cap) decide that; this just has to notice
 * promptly enough once they are satisfied.
 */
const TICK_MS = 15_000;

/**
 * Replace the editor's content while keeping the caret where it belongs (roadmap
 * B5). A remote edit — or a media re-derive — rewrites the whole doc, which would
 * otherwise snap the cursor to the top mid-typing. We capture the selection as a
 * text offset, apply the new content, then map that offset through the text change
 * and restore it, so an edit ELSEWHERE leaves your cursor put and an edit BEFORE it
 * carries it along. Shared by the CRDT bridge and the media re-derive so both paths
 * behave identically.
 */
function setContentPreservingCaret(editor: Editor, content: DocJSON): void {
  const beforeDoc = editor.state.doc;
  const beforeText = docText(beforeDoc);
  const fromOff = posToTextOffset(beforeDoc, editor.state.selection.from);
  const toOff = posToTextOffset(beforeDoc, editor.state.selection.to);

  editor.commands.setContent(content, { emitUpdate: false });

  const afterDoc = editor.state.doc;
  const afterText = docText(afterDoc);
  if (afterText === beforeText) return; // nothing moved; leave the caret
  const size = afterDoc.content.size;
  const mapped = mapSelectionThroughEdit(beforeText, afterText, fromOff, toOff);
  editor.commands.setTextSelection({
    from: Math.min(textOffsetToPos(afterDoc, mapped.from), size),
    to: Math.min(textOffsetToPos(afterDoc, mapped.to), size),
  });
}

/**
 * Sync `editor` to the CRDT for `docId`. When the cloud has no CRDT yet it is
 * seeded from `initialMarkdown` (the server render); afterwards the cloud CRDT is
 * the truth. Pass `enabled: false` to leave the editor alone (the /steps path).
 *
 * `lens` translates between stored and displayed markdown — vault-relative asset
 * paths in the CRDT versus loadable URLs in the browser (roadmap A6). Omit it and
 * the two are identical.
 */
export function useCrdtSync(
  editor: Editor | null,
  docId: string,
  initialMarkdown: string,
  enabled: boolean,
  lens?: MarkdownLens,
  mediaVersion = 0,
  /** Who to credit for versions this editor records. */
  author?: string,
  /** Called with the doc's comment threads whenever they change (roadmap B1). */
  onCommentThreads?: (threads: CommentView[]) => void,
  /** Points at the bound doc's Y.UndoManager so the editor's ⌘Z drives it
   *  (see the YUndo extension). Set on bind, cleared on unbind/rebind. */
  undoRef?: MutableRefObject<Y.UndoManager | null>
): CrdtStatus {
  const [status, setStatus] = useState<CrdtStatus>(enabled ? "connecting" : "off");
  // The seed for the CRDT's FIRST open. Kept current (not frozen) so that when
  // the editor rebinds to a different docId, that doc seeds from its own markdown
  // — the pool only uses this when the cloud CRDT is empty, so re-renders of an
  // already-open doc can't re-seed or clobber it.
  const initialRef = useLatest(initialMarkdown);
  // The lens is read when the session opens; keep it in a ref so a caller passing
  // a fresh object each render can not tear down and rebuild the CRDT session.
  const lensRef = useLatest(lens);
  const bindingRef = useRef<EditorBinding | null>(null);
  const authorRef = useLatest(author);
  const onCommentsRef = useLatest(onCommentThreads);
  const ports = useDocsPorts();

  useEffect(() => {
    if (!enabled || !editor) return;
    let disposed = false;
    let binding: EditorBinding | null = null;
    let detachUpdate = (): void => {};
    let stopTicker = (): void => {};

    void (async () => {
      // Warm-pool: reuse an already-open doc (its Y.Doc + live session + undo) if
      // we have one, else open it. The pool keeps it alive after we release, so
      // switching back is a rebind — no snapshot refetch. Seeds from initialRef
      // only when the cloud CRDT is empty (first open).
      const { doc, undo } = await docCrdtPool(ports).acquire(docId, initialRef.current);
      // The cleanup below always runs and releases this acquire, so bail without
      // releasing here (releasing again would double-count and evict a live doc).
      if (disposed) return;
      // The doc's undo stack lives on the pool entry, so ⌘Z survives this rebind.
      if (undoRef) undoRef.current = undo;

      const bridge = {
        readMarkdown: (): string => docJsonToMarkdown(editor.getJSON() as DocJSON),
        writeContent: (d: DocJSON): void => setContentPreservingCaret(editor, d),
      };
      binding = new EditorBinding(doc, bridge, lensRef.current);
      bindingRef.current = binding;
      // Derive THROUGH the binding, so the first paint resolves asset paths too —
      // deriving directly would show the raw `assets/…` paths as broken images.
      bridge.writeContent(binding.derive()); // seeded or hydrated

      const onUpdate = (): void => binding?.editorChanged();
      editor.on("update", onUpdate);
      detachUpdate = () => editor.off("update", onUpdate);

      // Record history (roadmap B3). The op-log already has every keystroke, so a
      // VERSION means "a thought finished" — shouldCheckpoint decides; this only
      // asks it often enough to notice. Versions land in the same Y.Doc, so they
      // sync and persist by the same path as the content, with nothing extra.
      let lastEditAt = Date.now();
      let lastVersionAt: number | null = null;
      let lastVersionContent = "";
      try {
        const already = versionCount(doc);
        if (already > 0) {
          lastVersionAt = listVersions(doc)[already - 1].at;
          lastVersionContent = versionContent(doc, already - 1);
        }
      } catch (e) {
        // A single corrupted version entry must NOT break live sync — otherwise the
        // whole effect rejects, `setStatus("live")` never runs, and (in dev) the
        // unhandled rejection stops Fast Refresh so edits need a manual reload.
        // History for this doc is unavailable; content, comments, and new versions
        // keep working.
        console.warn(`[crdt ${docId}] version history unavailable:`, e);
      }
      const detachObserve = observeMarkdown(doc, () => {
        lastEditAt = Date.now();
      });
      const ticker = setInterval(() => {
        const content = getMarkdown(doc);
        if (!shouldCheckpoint({ now: Date.now(), lastEditAt, lastVersionAt, lastVersionContent, content })) {
          return;
        }
        if (checkpoint(doc, { author: authorRef.current })) {
          lastVersionAt = Date.now();
          lastVersionContent = content;
        }
      }, TICK_MS);
      stopTicker = () => {
        clearInterval(ticker);
        detachObserve();
      };

      // Comment highlights (roadmap B1): the comments Y.Array is in THIS same doc,
      // so we read it here rather than opening a second session. observeDeep — a
      // resolve is a field edit inside an item, which a shallow observe misses.
      const stopComments = watchComments(doc, (t) => onCommentsRef.current?.(t));
      const stopTickerInner = stopTicker;
      stopTicker = () => {
        stopTickerInner();
        stopComments();
      };
      setStatus("live");
    })().catch((e) => {
      // Backstop: never let a sync-setup failure surface as an unhandled rejection
      // (which, in dev, breaks Fast Refresh).
      console.warn(`[crdt ${docId}] sync setup failed:`, e);
    });

    return () => {
      disposed = true;
      stopTicker();
      detachUpdate();
      binding?.destroy();
      bindingRef.current = null;
      if (undoRef) undoRef.current = null;
      // Release (don't close): the pool keeps the doc + session + undo warm so a
      // later rebind is instant, and closes it only once the LRU pushes it out.
      docCrdtPool(ports).release(docId);
    };
    // The refs are stable objects; listing them satisfies the dependency check
    // without making this effect — which tears down and rebuilds a CRDT session —
    // re-run for anything but a real rebind.
  }, [editor, docId, enabled, initialRef, lensRef, authorRef, onCommentsRef, undoRef, ports]);

  // The vault's asset list arrives AFTER the session opens and first derives, so
  // images would sit as unresolved `assets/…` paths until a reload — the lens being
  // correct is no help if nothing asks it again. Re-derive when media changes.
  //
  // Safe to repaint: the content is derived from the Y.Text either way, so this
  // cannot lose an edit; only the image srcs change.
  useEffect(() => {
    if (!enabled || !editor || mediaVersion === 0) return;
    const b = bindingRef.current;
    if (!b) return;
    setContentPreservingCaret(editor, b.derive());
  }, [mediaVersion, editor, enabled]);

  return status;
}
