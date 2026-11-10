"use client";

// The local-file backing for the CRDT pool.
//
// The document surface reads and writes ONE thing: a Y.Doc, handed to it by
// doc-crdt-pool.ts. Where that Y.Doc is backed is the pool's business — Supabase
// on the web, the shell's snapshot host on the desktop — and this file is the
// third backing: a loose `.md` file on disk, with nothing behind it. No account,
// no cloud, no other replica. The surface cannot tell, which is the point: the
// file window gets the same editor as a document, not a copy of it.
//
// A document is marked local by its id: `local:<absolute path>`. The pool routes
// such ids here and never touches a transport for them.
//
// What this does, in order of how much it matters:
//
//   • WRITES the markdown back to the file, debounced so typing does not write
//     the whole file per keystroke, and flushed when the window closes.
//   • TRACKS what is unsaved, so the window can show the dot in its title bar
//     and so an edit made elsewhere is never silently overwritten.
//   • TAKES changes made on disk by something else — another editor, a script.
//     With nothing unsaved here the file simply reseeds the Y.Doc; with unsaved
//     edits it is held, the writes stop, and the user decides which copy wins.
//
// The disk side — the path, the atomic write, the watcher — lives in the shell
// (apps/app/src/main.ts) and is reached through the LocalFilePort the shell
// supplies (see ports.tsx). The path never crosses it: the shell writes to the
// file the window was opened on and nothing else, so this code could not name
// another file if it tried.

import type * as Y from "yjs";
import { createDoc, getMarkdown, setMarkdown, observeMarkdown, type Origin } from "@markbase/docs";
import type { LocalFile, LocalFilePort, LocalSaveResult } from "./ports";

const LOCAL_DOC_PREFIX = "local:";

/** The pool id for a file on disk. */
export function localDocId(path: string): string {
  return LOCAL_DOC_PREFIX + path;
}

/** Whether a document id names a file on disk rather than a cloud document. */
export function isLocalDocId(docId: string): boolean {
  return docId.startsWith(LOCAL_DOC_PREFIX);
}

/**
 * The origin of edits that come FROM the file: the reseed when it changes on
 * disk. The save path ignores them (they are already on disk) and the undo
 * manager, which tracks "editor" only, leaves them out of ⌘Z.
 */
const FILE_ORIGIN: Origin = "file";

/** How long typing has to pause before the file is written. */
const SAVE_QUIET_MS = 500;

/** What the window shows about the file, beyond its content. */
export interface LocalFileState {
  /** Edits here that are not on disk yet. */
  dirty: boolean;
  /** The last write that failed, until one succeeds. */
  saveError: string | null;
  /**
   * The file changed on disk while there were unsaved edits here: the content
   * it now holds. Writes stop until the user reloads it or keeps theirs — an
   * autosave must never overwrite an edit it did not know about.
   */
  external: { content: string } | null;
  /** The file could not be read back from disk (moved, deleted, unreadable). */
  fileError: string | null;
}

const EXTERNAL_PENDING =
  "The file changed on disk while you had unsaved edits. Reload it or keep your edits before closing.";

/**
 * One file on disk, as a Y.Doc.
 *
 * Owned by the pool, like a SyncSession: created on the first `acquire` of its
 * id, closed when the pool lets the entry go. The window reaches it through the
 * pool entry to read the state above and to settle an external change.
 */
export class LocalFileSession {
  readonly doc: Y.Doc;

  private state: LocalFileState = { dirty: false, saveError: null, external: null, fileError: null };
  private readonly listeners = new Set<() => void>();
  /** Counts local edits; `saved` is its value as of the last write that landed. */
  private edits = 0;
  private saved = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inflight: Promise<LocalSaveResult> | null = null;
  private readonly stops: Array<() => void> = [];

  constructor(
    private readonly file: LocalFilePort,
    markdown: string
  ) {
    this.doc = createDoc(markdown);
    this.stops.push(
      observeMarkdown(this.doc, (origin) => {
        if (origin === FILE_ORIGIN) return;
        this.edited();
      }),
      file.onChanged((f) => this.changedOnDisk(f)),
      file.onFlush(() => this.flush())
    );
    // A reload of the page (not a close of the window) gets no flush from the
    // shell. The write is dispatched before the page goes; its answer is not
    // waited for, and need not be.
    if (typeof window !== "undefined") {
      const onPageHide = (): void => void this.flush();
      window.addEventListener("pagehide", onPageHide);
      this.stops.push(() => window.removeEventListener("pagehide", onPageHide));
    }
  }

  /** The current state. Stable between changes, so it suits useSyncExternalStore. */
  getState(): LocalFileState {
    return this.state;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private set(patch: Partial<LocalFileState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  private edited(): void {
    this.edits++;
    if (!this.state.dirty) {
      this.set({ dirty: true });
      this.file.setEdited(true);
    }
    this.schedule();
  }

  private schedule(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.save();
    }, SAVE_QUIET_MS);
  }

  /**
   * Write the current markdown, unless a write is already under way — that one
   * notices the newer edits and goes again. Resolves with the LAST write's
   * outcome, so a caller waiting on it (the close path) learns whether the
   * document is on disk.
   */
  private save(): Promise<LocalSaveResult> {
    if (this.inflight) return this.inflight;
    if (this.state.external) return Promise.resolve({ ok: false, error: EXTERNAL_PENDING });
    if (this.edits === this.saved) return Promise.resolve({ ok: true });
    const run = async (): Promise<LocalSaveResult> => {
      let result: LocalSaveResult = { ok: true };
      while (this.edits !== this.saved && !this.state.external) {
        const at = this.edits;
        const content = getMarkdown(this.doc);
        try {
          result = await this.file.save(content);
        } catch (e) {
          result = { ok: false, error: e instanceof Error ? e.message : String(e) };
        }
        if (!result.ok) break;
        this.saved = at;
      }
      this.inflight = null;
      if (!result.ok) {
        // Shown in the window; the next edit, or Retry, tries again.
        this.set({ saveError: result.error });
      } else if (this.edits === this.saved) {
        this.set({ dirty: false, saveError: null });
        this.file.setEdited(false);
      }
      return result;
    };
    this.inflight = run();
    return this.inflight;
  }

  /** Write now rather than after the pause. */
  flush(): Promise<LocalSaveResult> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    return this.save();
  }

  private changedOnDisk(file: LocalFile): void {
    if (file.error) {
      this.set({ fileError: file.error });
      return;
    }
    if (file.content === getMarkdown(this.doc)) {
      // The same bytes: our own write echoed, or a touch. Nothing to do.
      this.set({ fileError: null, external: null });
      return;
    }
    if (this.state.dirty) {
      this.set({ external: { content: file.content }, fileError: null });
      return;
    }
    setMarkdown(this.doc, file.content, FILE_ORIGIN);
    this.set({ fileError: null });
  }

  /** Take the file as it is on disk, dropping the edits made here. */
  reloadFromDisk(): void {
    const external = this.state.external;
    if (!external) return;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    setMarkdown(this.doc, external.content, FILE_ORIGIN);
    if (this.inflight) {
      // A write of ours may have landed under the external one; what is on disk
      // is uncertain, so this content is written back once that write settles.
      this.edits++;
      this.set({ external: null });
      this.schedule();
      return;
    }
    this.saved = this.edits;
    this.set({ external: null, dirty: false, saveError: null });
    this.file.setEdited(false);
  }

  /** Keep the edits made here: write them over what is on disk. */
  keepMine(): void {
    if (!this.state.external) return;
    this.set({ external: null });
    void this.flush();
  }

  /** Stop. Anything unsaved is written first. */
  close(): Promise<LocalSaveResult> {
    const result = this.flush();
    for (const stop of this.stops.splice(0)) stop();
    return result;
  }
}
