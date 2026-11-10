// Binds a rich (ProseMirror/Tiptap) editor to a Y.Text-is-truth Y.Doc — the
// browser half of F1, and the counterpart to VaultDoc on the worker.
//
// The editor never owns document state. A keystroke serializes the editor to
// markdown and diffs it into the Y.Text (origin "editor"); a Y.Text change from
// anywhere else (the cloud, another client) re-derives the ProseMirror structure
// and replaces the editor's content. The same primitives the worker uses
// (setMarkdown / derivedDoc) drive both directions, so the browser and the file
// converge on identical markdown.
//
// Two guards keep the directions from looping: edits we make are tagged with the
// "editor" origin and ignored by our own observer, and an `applyingRemote` latch
// swallows the editor's onUpdate that fires in response to our writeContent.

import * as Y from "yjs";
import { setMarkdown, getMarkdown, observeMarkdown, type Origin } from "./crdt";
import { markdownToDoc } from "./markdown";
import type { MarkdownLens } from "./media";
import type { DocJSON } from "./types";

const EDITOR_ORIGIN: Origin = "editor";

/** How the binding reads from / writes to a concrete editor. */
export interface EditorBridge {
  /** The editor's current content, serialized to markdown. */
  readMarkdown(): string;
  /** Replace the editor's content from a derived ProseMirror doc. */
  writeContent(doc: DocJSON): void;
}

export class EditorBinding {
  private applyingRemote = false;
  private readonly detach: () => void;

  /**
   * `lens` translates between what's stored and what the editor shows — today,
   * vault-relative asset paths in the Y.Text versus loadable URLs in the browser
   * (roadmap A6). It belongs exactly here, on the derive/serialize seam, so
   * Y.Text-is-truth is preserved: storage never sees a URL and the editor never
   * sees a path it can't load. Omit it and the two are the same text.
   */
  constructor(
    private readonly doc: Y.Doc,
    private readonly bridge: EditorBridge,
    private readonly lens?: MarkdownLens
  ) {
    this.detach = observeMarkdown(doc, (origin) => {
      if (origin === EDITOR_ORIGIN) return; // our own edit echoing back
      this.applyingRemote = true;
      try {
        this.bridge.writeContent(this.derive());
      } finally {
        this.applyingRemote = false;
      }
    });
  }

  /** The ProseMirror doc the editor should show for the current Y.Text. */
  derive(): DocJSON {
    const stored = getMarkdown(this.doc);
    const shown = this.lens ? this.lens.toEditor(stored) : stored;
    return markdownToDoc(shown).toJSON() as DocJSON;
  }

  /** Call when the editor's content changed (the user typed). */
  editorChanged(): void {
    if (this.applyingRemote) return; // this fired from our own writeContent
    const shown = this.bridge.readMarkdown();
    setMarkdown(this.doc, this.lens ? this.lens.toStorage(shown) : shown, EDITOR_ORIGIN);
  }

  destroy(): void {
    this.detach();
  }
}
