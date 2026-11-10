// Disk ↔ CRDT reconcile layer for the local vault (roadmap F1, local half).
//
// Binds one Y.Doc to one markdown file. External edits (an agent, vim, the
// editor writing the file) flow IN as a character diff; CRDT changes (from the
// cloud, or the editor) flush OUT to the file. Two hazards this layer exists to
// handle:
//
//   1. The write-back loop. Flushing the CRDT to disk makes the file watcher
//      fire with our own bytes; without a guard that re-enters as a "change" and
//      loops forever. We track the last-synced content and ignore an incoming
//      file state that already equals it.
//
//   2. Divergence. If the CRDT advanced (a cloud edit arrived) AND the file
//      changed since we last synced, blindly applying the file would revert the
//      cloud edit. We three-way merge (base = last synced, ours = CRDT now,
//      theirs = file) so both survive — when they touch different lines. When
//      they touch the SAME lines there is no merge, and the document takes
//      the cloud's text; the file's text is handed back to the caller, which
//      keeps a copy beside the file (.conflicts/). Git-style markers used to be
//      written into the document instead, and markdown read them as text: the
//      `=======` line under a paragraph is a heading, so a conflict retitled
//      the document after its own markers and renamed the file to match.
//
// Pure and fs-injectable: the actual chokidar/node-fs wiring lives in the
// worker and calls these methods, so this stays unit-testable and browser-safe.

import * as Y from "yjs";
import {
  createDoc,
  getMarkdown,
  setMarkdown,
  applyUpdate,
  threeWayMerge,
  type Origin,
} from "./crdt";

/**
 * The transaction origin carried by an edit that came off THIS machine's disk.
 *
 * Exported because it is how a reader tells "you typed this in Obsidian" apart
 * from "this arrived from the cloud" ("remote") or "this is the hydrated
 * snapshot" ("persist") — which is what decides whose name goes on a version.
 */
export const LOCAL_ORIGIN = "vault:file";

export interface FlushResult {
  /** Whether the file needs writing (CRDT differs from what's on disk). */
  wrote: boolean;
  /** The content to write (only meaningful when `wrote`). */
  content: string;
}

export interface ApplyResult {
  /** Whether the incoming file content changed the CRDT. */
  changed: boolean;
  /** True when the file diverged from a concurrently-advanced CRDT and was merged. */
  merged: boolean;
  /** True when the two sides edited the same lines and could not be merged. */
  conflict: boolean;
  /**
   * On a conflict: the file's text, which the document did NOT take (it kept
   * the cloud's). The caller saves it where the person can find it — nothing
   * is lost, and nothing unparseable is pushed.
   */
  rejected?: string;
}

/**
 * One document's disk ↔ CRDT binding. `lastSynced` is the content known to be
 * common to both sides; it's the loop-guard reference and the merge base.
 */
export class VaultDoc {
  readonly doc: Y.Doc;
  private lastSynced: string;

  constructor(initialMarkdown = "") {
    this.doc = createDoc(initialMarkdown);
    this.lastSynced = initialMarkdown;
  }

  /** Current CRDT markdown (the source of truth). */
  markdown(): string {
    return getMarkdown(this.doc);
  }

  /**
   * Declare the current CRDT state as the synced baseline. Used right after
   * hydrating the doc from the cloud, so a subsequent `applyFileContent` diffs
   * the on-disk file against the cloud state (a character delta) instead of
   * three-way merging against an empty base (which would duplicate content).
   */
  markSynced(): void {
    this.lastSynced = this.markdown();
  }

  /**
   * Set the synced baseline to a specific known-common content — a base
   * persisted from a previous run. On restart this is the last content disk and
   * cloud shared, so a following `applyFileContent` three-way merges an offline
   * disk edit against a concurrently-advanced cloud instead of clobbering it.
   */
  setSyncBase(base: string): void {
    this.lastSynced = base;
  }

  /** The content both sides are known to share — persist this as the base. */
  syncedContent(): string {
    return this.lastSynced;
  }

  /**
   * Absorb a file's content into the CRDT. No-op if it already matches the
   * last-synced state (this is how our own flush, echoed back by the watcher,
   * is ignored). If the CRDT advanced meanwhile, three-way merge instead of
   * clobbering.
   */
  applyFileContent(fileContent: string, origin: Origin = LOCAL_ORIGIN): ApplyResult {
    if (fileContent === this.lastSynced) {
      return { changed: false, merged: false, conflict: false };
    }
    const crdtNow = this.markdown();

    // CRDT untouched since last sync → the file is authoritative for this change.
    if (crdtNow === this.lastSynced) {
      setMarkdown(this.doc, fileContent, origin);
      this.lastSynced = fileContent;
      return { changed: true, merged: false, conflict: false };
    }

    // Both diverged → merge so neither side's edit is lost.
    const merged = threeWayMerge(this.lastSynced, crdtNow, fileContent);
    if (merged.conflict) {
      // The same lines, two ways: the cloud's text stands, the file's goes back
      // to the caller to keep. Marking the base as the CRDT means the flush
      // that follows rewrites the file from the cloud.
      this.lastSynced = crdtNow;
      return { changed: false, merged: true, conflict: true, rejected: fileContent };
    }
    setMarkdown(this.doc, merged.text, origin);
    this.lastSynced = merged.text;
    return { changed: true, merged: true, conflict: false };
  }

  /**
   * Apply a remote Yjs update (a cloud/other-client edit) into the CRDT. Does
   * not touch `lastSynced` — the change still needs flushing to disk.
   */
  applyRemoteUpdate(update: Uint8Array): void {
    applyUpdate(this.doc, update);
  }

  /**
   * What to write to disk to bring the file in line with the CRDT. Records the
   * flushed content as last-synced so the watcher's echo of this write is a
   * no-op. Returns wrote=false when the file already matches.
   */
  flushToDisk(): FlushResult {
    const md = this.markdown();
    if (md === this.lastSynced) return { wrote: false, content: md };
    this.lastSynced = md;
    return { wrote: true, content: md };
  }

  /**
   * A file-delete event. The document is NOT deleted — a crashed editor, a
   * `git checkout`, or an over-eager cleanup must never destroy content. The
   * CRDT is the truth; the caller re-writes the file from `content`.
   */
  onFileRemoved(): FlushResult {
    // Force a re-write of the current CRDT state regardless of last-synced.
    const md = this.markdown();
    this.lastSynced = md;
    return { wrote: true, content: md };
  }

  /** The Yjs update delta to ship to the cloud/other clients. */
  encodeUpdate(): Uint8Array {
    return Y.encodeStateAsUpdate(this.doc);
  }
}

/**
 * Minimal filesystem surface a VaultFolder needs. Injected so the orchestration
 * is unit-testable and browser-safe; the real chokidar/node-fs adapter lives in
 * the worker and implements this.
 */
// Declared in @markbase/protocol so the daemon that implements it and the engine
// that consumes it share one definition without importing each other.
import type { VaultFs } from "@markbase/protocol/storage";
export type { VaultFs };

/**
 * A folder of markdown files, each bound to its own VaultDoc. Routes disk events
 * to the right doc, adopts files it hasn't seen, restores a doc's file if it's
 * removed (content lives in the CRDT, never lost to an errant delete), and
 * batch-flushes CRDT-ahead docs back to disk.
 */
export class VaultFolder {
  private docs = new Map<string, VaultDoc>();

  constructor(private readonly fs: VaultFs) {}

  private ensure(path: string): VaultDoc {
    let vd = this.docs.get(path);
    if (!vd) {
      vd = new VaultDoc();
      this.docs.set(path, vd);
    }
    return vd;
  }

  /** A file appeared or changed on disk — adopt it / absorb the edit. */
  fileChanged(path: string): void {
    const content = this.fs.read(path);
    if (content === null) return;
    this.ensure(path).applyFileContent(content);
  }

  /** A file was removed on disk — restore it from the CRDT rather than lose it. */
  fileRemoved(path: string): void {
    const vd = this.docs.get(path);
    if (!vd) return;
    this.fs.write(path, vd.onFileRemoved().content);
  }

  /** A remote (cloud/other-client) update for one doc. */
  applyRemote(path: string, update: Uint8Array): void {
    this.ensure(path).applyRemoteUpdate(update);
  }

  /** Write every doc whose CRDT is ahead of disk. Returns the paths written. */
  flush(): string[] {
    const written: string[] = [];
    for (const [path, vd] of this.docs) {
      const r = vd.flushToDisk();
      if (r.wrote) {
        this.fs.write(path, r.content);
        written.push(path);
      }
    }
    return written;
  }

  get(path: string): VaultDoc | undefined {
    return this.docs.get(path);
  }

  paths(): string[] {
    return [...this.docs.keys()];
  }
}
