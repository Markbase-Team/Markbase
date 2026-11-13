// The worker's multi-document vault: one synced file per document, plus routing
// of disk events to the right one (roadmap F1, worker wiring).
//
// This manager owns the CONTAINER: which paths exist, who claims them, what the
// watcher's events mean, adoption of new files, restoring deleted ones, and the
// nesting rules. It does not own what is inside a file. That arrives as an
// `OpenSyncedFile` — the caller decides a file's contents are a CRDT document
// (see docs-synced-file.ts) and this routes to it through `SyncedFile`.
//
// So there is no store, no pubsub and no base store here any more: those are
// transport and persistence details of one content type, closed over by whoever
// supplies the opener. What is left is pure routing, which is why these tests
// need no CRDT at all to exercise it.

import { filesUnder, normalizePath } from "@markbase/protocol/folders";
import type { VaultSyncFs } from "@markbase/protocol/storage";
import type { AgentCredit, OpenSyncedFile, SyncedFile } from "./synced-file";

// VaultDocRef is a document's identity, so it belongs to the protocol rather
// than to the sync engine. Re-exported here because every existing caller
// imports it alongside VaultSyncManager.
export type { VaultDocRef } from "@markbase/protocol/vault-reconcile";
import type { VaultDocRef } from "@markbase/protocol/vault-reconcile";

/** A file whose edits the source of truth has not got (see SyncedFile). */
export interface LocalFork {
  docId: string;
  path: string;
}

/** Create a cloud document for a new local file; returns its id (or null on failure). */
export type AdoptFile = (path: string, content: string) => Promise<string | null>;

export interface VaultSyncOptions {
  /** How to turn a new local file into a cloud document. Omit to disable adoption. */
  adopt?: AdoptFile;
  /**
   * Called after a doc moves to a new path, so the caller can persist it (the
   * document's stored path is what carries folders). Without this a move is only
   * re-keyed in memory and the next sync pulls the file back to its old path.
   */
  onMoved?: (docId: string, newPath: string) => void;
  /**
   * Progress through the initial open. Each document costs a snapshot load, so a
   * vault of any size spends minutes here on a restart with nothing to show for
   * it — 102 documents took 40 seconds.
   */
  onOpened?: (done: number, total: number) => void;
  /**
   * Who to credit for versions recorded from this machine's disk — the PERSON
   * who owns this vault, not the machine or the connection. You edited the file
   * in Obsidian; the daemon is transport.
   *
   * Omitted (or null), documents still record history, just unattributed: a
   * daemon that could not resolve its owner must not stop keeping versions.
   */
  author?: string | null;
  /**
   * For a file, the way to ask which agent wrote a change to it (the agent
   * audit's record of what agents' hooks reported). `path` is read when asked,
   * so a renamed file is still found. Omitted, every version is the author's.
   */
  agentCredit?: (path: () => string) => AgentCredit;
}

export class VaultSyncManager {
  private readonly byPath = new Map<string, SyncedFile>();
  // Paths whose VaultSync is mid-open. VaultSync.open WRITES the file (materializes
  // it) before we can record it in byPath, and our own watcher sees that write — so
  // unless an in-flight path already counts as tracked, the daemon adopts its OWN
  // materialization as a brand-new document, which then collides with the original
  // and spawns an ever-growing chain of "Untitled" duplicates on every reconcile. A
  // reserved path routes a watcher event to fileChanged (a no-op echo), never adopt.
  private readonly opening = new Set<string>();

  /**
   * Paths the CLOUD says are taken, and by which document — straight from the
   * document list, independent of whether we managed to open any of them.
   *
   * Adoption used to be gated on `byPath`/`opening`: a live handle. But a handle
   * is runtime state, and it disappears for reasons that have nothing to do with
   * whether a document exists — a snapshot fetch cut off mid-body ("TypeError:
   * terminated") drops the doc out of `byPath`, and the next disk sweep then finds
   * a file whose path looks unowned and adopts it AGAIN. That is how one network
   * blip turned learning/07-glm52-architecture.md into two documents and a
   * collision file, with all four adoption guards blind: even findByContent misses
   * it, because it only walks the docs it managed to open.
   *
   * Existence is settled by the LIST, not by the open. `listDocs` already answered
   * "there is a document at this path" — a failure to materialize it has no
   * standing to overturn that. So ownership lives here, survives an open failure,
   * and is only released when a later list stops mentioning the document (the same
   * reasoning as reconcile's "never act on a failed fetch": an error is not
   * evidence of absence).
   */
  private readonly claimed = new Map<string, string>();

  private constructor(
    private readonly fs: VaultSyncFs,
    private readonly openFile: OpenSyncedFile,
    private readonly opts: VaultSyncOptions
  ) {}

  /** Open a synced file for each document, reconciling cloud and disk up front. */
  static async open(
    docs: VaultDocRef[],
    fs: VaultSyncFs,
    openFile: OpenSyncedFile,
    opts: VaultSyncOptions = {}
  ): Promise<VaultSyncManager> {
    const m = new VaultSyncManager(fs, openFile, opts);
    // Claim every listed path BEFORE opening any of them: the opens below are
    // allowed to fail, and the startup sweep that follows must still see these
    // paths as spoken for.
    m.setClaims(docs);
    let done = 0;
    for (const d of docs) {
      opts.onOpened?.(done++, docs.length);
      try {
        await m.openInto(d.path, () =>
          m.openFile({ docId: d.id, path: d.path, seed: d.seed, readOnly: d.readOnly })
        );
      } catch (e) {
        // One doc that can't open must not abort opening the whole vault — it may
        // be deleted upstream (seeding its CRDT violates a foreign key) or simply
        // a fetch that died in transit. Its path stays claimed either way, so the
        // sweep that runs next can't mistake its file for a new document, and the
        // first reconcile puts it back in plan.open.
        console.warn(
          `[vault-sync] couldn't open ${d.path} (still claimed, will retry): ` +
            `${e instanceof Error ? e.message : String(e)}`
        );
      }
    }
    opts.onOpened?.(docs.length, docs.length);
    return m;
  }

  /**
   * Reserve `path`, open its VaultSync, then record it — one step from the
   * watcher's point of view. The reservation makes `path` count as tracked while
   * VaultSync.open materializes the file, so the watcher event that write triggers
   * is a harmless echo (fileChanged) rather than a self-adopt (adoptFile). No-op if
   * the path is already tracked or being opened.
   */
  private async openInto(path: string, open: () => Promise<SyncedFile>): Promise<void> {
    if (this.byPath.has(path) || this.opening.has(path)) return;
    this.opening.add(path);
    try {
      const vs = await open();
      vs.trackVersions(this.opts.author ?? null, this.opts.agentCredit?.(() => vs.path));
      this.byPath.set(path, vs);
    } finally {
      this.opening.delete(path);
    }
  }

  /**
   * A file changed on disk. Routes to the doc bound to that path; returns false
   * for a path we don't track (a brand-new file — see `adoptFile`).
   */
  fileChanged(path: string): boolean {
    const vs = this.byPath.get(path);
    if (!vs) {
      // No VaultSync yet — but if we're mid-open at this path, the write is our OWN
      // materialization. Report it handled so the caller doesn't adopt it.
      return this.opening.has(path);
    }
    vs.fileChanged();
    return true;
  }

  /**
   * A new file on disk with no document yet: create a cloud document for it and
   * start syncing. Returns the new doc id, or null if adoption is off, the path
   * is already tracked, or the file vanished.
   */
  async adoptFile(path: string): Promise<string | null> {
    // `claimed` included: a path the cloud already owns is never a new document,
    // however little of it we currently hold.
    if (this.has(path) || !this.opts.adopt) return null;
    const content = this.fs.read(path);
    if (content === null) return null;
    // Reserve across BOTH the network create and the open: the byPath entry doesn't
    // exist until the very end, so a second watcher event for the same file must not
    // start a second adoption while this one is still in flight.
    this.opening.add(path);
    try {
      const id = await this.opts.adopt(path, content);
      if (id === null) return null;
      // Adoption bypasses openInto, so version tracking has to be switched on
      // here too — otherwise a file you created locally keeps no history at all.
      const vs = await this.openFile({ docId: id, path });
      vs.trackVersions(this.opts.author ?? null, this.opts.agentCredit?.(() => vs.path));
      this.byPath.set(path, vs);
      return id;
    } finally {
      this.opening.delete(path);
    }
  }

  /** A file was removed on disk — restore it from the CRDT (never lose content). */
  fileRemoved(path: string): void {
    this.byPath.get(path)?.restore();
  }

  /**
   * A tracked file was renamed/moved on disk. Re-key its VaultSync to the new
   * path so it isn't restored at the old path (recreating a duplicate) or
   * re-adopted at the new one. Returns false if the old path isn't tracked or the
   * new path already is.
   *
   * `persist: false` for a move the CLOUD handed us: onMoved reports moves we
   * DISCOVERED, and echoing one back would rewrite the same value on every poll.
   */
  moveDoc(oldPath: string, newPath: string, opts: { persist?: boolean } = {}): boolean {
    const vs = this.byPath.get(oldPath);
    if (!vs || this.byPath.has(newPath) || this.opening.has(newPath)) return false;
    this.byPath.delete(oldPath);
    vs.rename(newPath);
    this.byPath.set(newPath, vs);
    // The claim moves with the document. Leaving it on the old path would keep a
    // file that reappears there un-adoptable until the next list arrives.
    this.reclaim(oldPath, newPath);
    // Persist the new location, or the next sync would pull the file back.
    if (opts.persist !== false) this.opts.onMoved?.(vs.docId, newPath);
    return true;
  }

  /** Start syncing a document we didn't have — created on another device. */
  async openDoc(ref: VaultDocRef): Promise<void> {
    await this.openInto(ref.path, () =>
      this.openFile({ docId: ref.id, path: ref.path, seed: ref.seed, readOnly: ref.readOnly })
    );
  }

  // ---- Read-only files and their forks (the Shared Vault) -------------------

  /**
   * Hold back, or resume, a tracked file's writes to the source of truth —
   * the person's capability on a shared document changed. Returns whether the
   * path is tracked and its content type knows the difference.
   */
  setReadOnly(path: string, readOnly: boolean): boolean {
    const vs = this.byPath.get(path);
    if (!vs?.setReadOnly) return false;
    vs.setReadOnly(readOnly);
    return true;
  }

  /** Every tracked file carrying edits the source of truth has not got. */
  localForks(): LocalFork[] {
    const out: LocalFork[] = [];
    for (const [path, vs] of this.byPath) {
      if (vs.hasLocalEdits?.()) out.push({ docId: vs.docId, path });
    }
    return out;
  }

  /** The tracked file for a document id, if any. */
  private byDocId(docId: string): SyncedFile | null {
    for (const vs of this.byPath.values()) if (vs.docId === docId) return vs;
    return null;
  }

  /** Both sides of a fork, for a comparison. Null when the document is not
   *  tracked here or is not forked. */
  forkContents(docId: string): { cloud: string; local: string; path: string } | null {
    const vs = this.byDocId(docId);
    if (!vs?.hasLocalEdits?.()) return null;
    const cloud = vs.cloudContent?.();
    if (cloud === null || cloud === undefined) return null;
    return { cloud, local: vs.content(), path: vs.path };
  }

  /** Drop a fork: the file goes back to the source of truth. */
  discardFork(docId: string): boolean {
    return this.byDocId(docId)?.discardLocalEdits?.() ?? false;
  }

  /** Stop syncing one document. The file on disk is the caller's business. */
  closeDoc(path: string): boolean {
    const vs = this.byPath.get(path);
    if (!vs) return false;
    vs.close();
    this.byPath.delete(path);
    // Closing means this document is no longer ours to sync here — it was deleted,
    // or its subtree became another vault. Either way we stop speaking for the path.
    this.claimed.delete(path);
    return true;
  }

  /** Move a path's claim, keeping the document id. No-op if it wasn't claimed. */
  private reclaim(from: string, to: string): void {
    const id = this.claimed.get(from);
    if (id === undefined) return;
    this.claimed.delete(from);
    this.claimed.set(to, id);
  }

  /** Every document we sync, as id+path — the input to a cloud reconcile, which
   *  must key on identity (the id), never on the path. */
  refs(): VaultDocRef[] {
    return [...this.byPath.entries()].map(([path, vs]) => ({ id: vs.docId, path }));
  }

  /** The document id bound to a path, if we track it. */
  docIdOf(path: string): string | null {
    return this.byPath.get(path)?.docId ?? null;
  }

  has(path: string): boolean {
    return this.byPath.has(path) || this.opening.has(path) || this.claimed.has(path);
  }

  /**
   * Replace what the cloud says it owns. Called with each reconcile's freshly
   * assigned paths, so a move re-points a claim and a document that genuinely
   * disappeared releases its path — after which adoption may have it.
   *
   * Only ever call this with a list that ARRIVED. Handing it the empty array on a
   * failed fetch would free every path in the vault and invite the sweep to adopt
   * the whole folder a second time.
   */
  setClaims(docs: VaultDocRef[]): void {
    this.claimed.clear();
    for (const d of docs) this.claimed.set(d.path, d.id);
  }

  /** The id of the document the cloud puts at `path`, or null if it's free. */
  claimedBy(path: string): string | null {
    return this.claimed.get(path) ?? null;
  }

  /** Listed paths we have not got a live handle for — opened next reconcile. */
  unopenedClaims(): string[] {
    return [...this.claimed.keys()].filter((p) => !this.byPath.has(p) && !this.opening.has(p));
  }

  /** The CRDT markdown of a tracked path (used to correlate a rename's unlink+add). */
  markdownOf(path: string): string | null {
    const vs = this.byPath.get(path);
    return vs ? vs.content() : null;
  }

  /**
   * Given content that just appeared at a new path, find the tracked doc it came
   * from — one whose content matches and whose file has vanished. That means this
   * is a move, not a new document.
   *
   * Deliberately ordering-independent: a folder move on macOS does NOT deliver a
   * tidy unlink-then-add per file, so correlating on the watcher's event order
   * silently re-adopted every moved file as a duplicate. Matching on
   * content + "the old file is gone" needs no unlink at all.
   */
  findMovedFrom(content: string, exists: (path: string) => boolean): string | null {
    for (const [path, vs] of this.byPath) {
      if (vs.content() === content && !exists(path)) return path;
    }
    return null;
  }

  /**
   * A document we already sync whose content is exactly this, or null.
   *
   * Unlike findMovedFrom this does NOT require the other file to be gone. It
   * answers a different question: "is this file a second copy of something we
   * already have?" — which is what tells a stale duplicate apart from new
   * material, and the only thing that distinguishes them when both files exist.
   */
  findByContent(content: string): string | null {
    for (const [path, vs] of this.byPath) {
      if (vs.content() === content) return path;
    }
    return null;
  }

  /**
   * Stop syncing every doc under `folder` — it belongs to another vault now
   * (dragged in, or converted in place while we were running).
   *
   * Refusing to *adopt* a nested vault's files only guards the intake half: a doc
   * we already track keeps being WRITTEN to its path on every cloud update, which
   * would pour our content straight into another daemon's tree. Closing is what
   * makes the boundary real in both directions. The files are left exactly as
   * they are on disk — they're the other vault's to own now, not ours to tidy.
   *
   * Returns the paths dropped.
   */
  closeUnder(folder: string): string[] {
    const f = normalizePath(folder);
    // "" is within every folder, so this would quietly unsync the whole vault.
    if (f === "") throw new Error("closeUnder: refusing to close the vault root");
    const victims = filesUnder([...this.byPath.keys()], f);
    for (const p of victims) {
      this.byPath.get(p)?.close();
      this.byPath.delete(p);
      this.claimed.delete(p); // that subtree is another vault's business now
    }
    return victims;
  }

  /**
   * Record a version for every document whose local editing has settled.
   *
   * One sweep over every open doc, rather than a timer per document: a vault of
   * a hundred notes would otherwise hold a hundred intervals to do nothing most
   * of the time. Each doc decides for itself whether it is due, and ignores
   * changes that arrived from the cloud. Returns how many were recorded.
   */
  /**
   * Resolve every held empty read; returns how many documents were emptied.
   *
   * Deliberately its own method rather than folded into checkpointDue: one
   * records history, this one settles a write race, and a sweep named for
   * versioning that quietly empties files would be the kind of coupling nobody
   * finds until it misfires.
   */
  confirmPendingEmpties(): number {
    let emptied = 0;
    for (const vs of this.byPath.values()) {
      if (vs.confirmPendingEmpty()) emptied++;
    }
    return emptied;
  }

  checkpointDue(now: number = Date.now()): number {
    let recorded = 0;
    for (const vs of this.byPath.values()) {
      if (vs.maybeCheckpoint(now)) recorded++;
    }
    return recorded;
  }

  paths(): string[] {
    return [...this.byPath.keys()];
  }

  closeAll(): void {
    for (const vs of this.byPath.values()) vs.close();
    this.byPath.clear();
  }
}
