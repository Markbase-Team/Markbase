// One document's full local-vault binding for the worker (roadmap F1).
//
// A single Y.Doc is shared between the cloud SyncSession (a Supabase snapshot +
// a Realtime channel) and the on-disk markdown file (VaultDoc). Everything flows
// through that one CRDT, so the two directions compose without special-casing:
//
//   file edit  -> applyFileContent -> Y.Doc update -> SyncSession publishes+persists
//   cloud edit -> SyncSession applies -> Y.Doc update -> flush to the file
//
// The watcher's echo of our own writes is absorbed by VaultDoc's last-synced
// guard (the flushed content equals last-synced, so re-reading it is a no-op),
// so neither direction loops.
//
// Headless and fs-injectable: the real chokidar/node-fs wiring lives in the
// worker and provides `VaultSyncFs`, keeping this unit-testable with no disk.

import * as Y from "yjs";
import { VaultDoc, LOCAL_ORIGIN, type ApplyResult } from "./vault";
import { SyncSession, type DocStore, type DocPubSub } from "./transport";
import { checkpoint, listVersions, shouldCheckpoint, versionContent, versionCount } from "./versions";
import { getMarkdown, observeMarkdown, setMarkdown, type Origin } from "./crdt";
import { snapshot } from "./sync";
import type { VaultSyncFs, VaultBaseStore } from "@markbase/protocol/storage";

/**
 * The origin of a "discard my edits" rewrite: the local replica being put back
 * to what the cloud has. Neither a disk edit (it must not be credited as one)
 * nor a cloud update (the shadow below must not apply it to itself).
 */
const DISCARD_ORIGIN = "vault:discard";

/** The origins a cloud update arrives under (SyncSession's words for them). */
const CLOUD_ORIGINS = new Set<Origin>(["remote", "persist"]);

export interface VaultSyncOpenOptions {
  /**
   * The user may read this document but not write it — a viewer or a
   * commenter of a shared document. The replica still applies every cloud
   * update and still writes the file; what it never does is SAVE: the server
   * would refuse (403), and the refusal would reach nobody.
   *
   * An edit made to the file anyway is kept as a live fork (docs/shared-vault.md):
   * absorbed into the replica, merged with whatever the cloud sends next,
   * written back to disk, and never sent up. `hasLocalEdits` says when that is
   * the case; `setReadOnly(false)` — the user became an editor — saves it, and
   * the server merges the fork like any other snapshot.
   */
  readOnly?: boolean;
  /**
   * The file and the cloud changed the same lines, so the document kept the
   * cloud's text and the file's was saved beside it. `copy` is where, relative
   * to the vault (`.conflicts/<name> <stamp>.md`) — for the host to tell the
   * person, since nothing in the document says so.
   */
  onConflict?: (conflict: { path: string; copy: string }) => void;
}

// Declared in @markbase/protocol, not here: the vault daemon implements these
// and used to import them from this package, which pointed the dependency the
// wrong way round. Re-exported because callers (and these tests) import them
// from here.
export type { VaultSyncFs, VaultBaseStore };

/** Where a conflicted file's own text goes: `.conflicts/<name> <stamp>.md`, beside the vault's files. */
export function conflictCopyPath(path: string, now: Date = new Date()): string {
  const stamp = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const name = (path.split("/").pop() ?? path).replace(/\.md$/i, "");
  return `.conflicts/${name} ${stamp}.md`;
}

/** A merge that rejected the file's text: save that text beside the file and say so. */
function keepRejected(
  fs: VaultSyncFs,
  path: string,
  r: ApplyResult,
  onConflict?: (conflict: { path: string; copy: string }) => void
): void {
  if (r.rejected === undefined) return;
  const copy = conflictCopyPath(path);
  fs.write(copy, r.rejected);
  onConflict?.({ path, copy });
}

/**
 * Which agent wrote a file's content, if one did — asked for every change read
 * off the disk. `agent` is what is known now; `later` asks again, for a write
 * whose record had not landed yet when the file changed (an agent's hook
 * reports after its tool finishes, and the watcher can be quicker).
 *
 * The answer comes from the vault's agent audit (@markbase/vault,
 * agent-audit.ts): this module only asks, and knows nothing of hooks.
 */
export type AgentCredit = (content: string) => { agent: string | null; later: () => string | null };

export class VaultSync {
  private detach: () => void = () => {};

  // --- Version tracking. Off until trackVersions() is called. ---
  /** Who to credit — a person, not this machine. Null records unattributed. */
  private author: string | null = null;
  private tracking = false;
  private detachObserve: () => void = () => {};
  /** When the markdown last changed, and where that change came from. */
  private lastEditAt = 0;
  private lastOrigin: Origin = null;
  private lastVersionAt: number | null = null;
  private lastVersionContent = "";
  /** Asks which agent wrote a change; absent, every change is the author's. */
  private credit: AgentCredit | null = null;
  /**
   * The file changes absorbed since the last version, each as the agent that
   * made it, or — not known yet — a way to ask again when the version is cut.
   */
  private pendingWrites: { agent: string | null; later: () => string | null }[] = [];

  /** An empty read of a non-empty document, held until the sweep confirms it. */
  private pendingEmpty = false;

  /**
   * The cloud's copy, kept beside the replica while the document is read-only.
   *
   * Every update that arrives from the cloud is applied to both; nothing made
   * here reaches it. So the two agree exactly until the file is edited, and
   * "has local-only edits" is their markdown differing — which also clears
   * itself when the person reverts by hand, or when an editor lands the same
   * change. Null while the document is writable: then the cloud IS the replica,
   * a save behind.
   */
  private shadow: Y.Doc | null = null;
  private detachShadow: () => void = () => {};

  private constructor(
    readonly docId: string,
    public path: string,
    private readonly vaultDoc: VaultDoc,
    private readonly session: SyncSession,
    private readonly fs: VaultSyncFs,
    /** The real store — saves go here only while writable (see `mode`). */
    private readonly store: DocStore,
    /** Shared with the session's store wrapper, so a flip reaches it. */
    private readonly mode: { readOnly: boolean },
    private readonly baseStore?: VaultBaseStore,
    private readonly onConflict?: (conflict: { path: string; copy: string }) => void
  ) {}

  /**
   * The content both sides share, for the next start to merge against.
   *
   * Writable: what the file and the replica last agreed on. Read-only: what the
   * CLOUD has, because the replica may be a fork — and a base that already
   * contained the fork would make the next start read the file as "unchanged",
   * hydrate from the cloud, and write the cloud's text over the person's edits.
   * With the cloud as the base, the file is seen as an edit on top of it and
   * carried into the fresh replica, merged with whatever the cloud did since.
   */
  private persistBase(): void {
    if (!this.baseStore) return;
    this.baseStore.save(
      this.docId,
      this.shadow ? getMarkdown(this.shadow) : this.vaultDoc.syncedContent()
    );
  }

  /** Whether this document is held read-only (see VaultSyncOpenOptions). */
  get readOnly(): boolean {
    return this.mode.readOnly;
  }

  /**
   * Local edits the cloud has not got — only ever true while read-only. A
   * writable document's edits are a save away, never "local-only".
   */
  hasLocalEdits(): boolean {
    if (!this.shadow) return false;
    return getMarkdown(this.shadow) !== this.vaultDoc.markdown();
  }

  /** The cloud's markdown, for a comparison against the fork. Null when writable. */
  cloudMarkdown(): string | null {
    return this.shadow ? getMarkdown(this.shadow) : null;
  }

  /**
   * Put the replica — and so the file — back to what the cloud has, dropping
   * every local-only edit. No-op when there is no fork.
   */
  discardLocalEdits(): boolean {
    if (!this.shadow || !this.hasLocalEdits()) return false;
    // A plain content rewrite, not a Yjs-level rollback: the fork's ops stay in
    // the replica's history as inserted-then-deleted, which is exactly what a
    // save would carry if the person later became an editor — harmless.
    setMarkdown(this.vaultDoc.doc, getMarkdown(this.shadow), DISCARD_ORIGIN);
    return true;
  }

  /**
   * Change whether this document may be written up.
   *
   * Turning writes ON is how a fork lands: the replica already holds the cloud's
   * history plus the person's edits, so one save merges it server-side with no
   * text-level step. The shadow is dropped — the cloud is the replica again.
   * Turning them OFF (an editor demoted) raises a shadow from the replica as it
   * stands, which the cloud has or is about to have.
   */
  setReadOnly(readOnly: boolean): void {
    if (readOnly === this.mode.readOnly) return;
    this.mode.readOnly = readOnly;
    if (readOnly) {
      this.raiseShadow(snapshot(this.vaultDoc.doc));
    } else {
      this.detachShadow();
      this.detachShadow = () => {};
      this.shadow = null;
      // Everything the fork had, in one merge. Not awaited: the store reports
      // its own failures, and a failed save is retried by the next edit.
      void this.store.save(this.docId, snapshot(this.vaultDoc.doc));
    }
    this.persistBase();
  }

  /** Start keeping the cloud's copy beside the replica, from `state`. */
  private raiseShadow(state: Uint8Array | null): void {
    const shadow = new Y.Doc();
    if (state) Y.applyUpdate(shadow, state);
    this.shadow = shadow;
    const onUpdate = (update: Uint8Array, origin: Origin): void => {
      if (CLOUD_ORIGINS.has(origin)) Y.applyUpdate(shadow, update);
    };
    this.vaultDoc.doc.on("update", onUpdate);
    this.detachShadow = () => this.vaultDoc.doc.off("update", onUpdate);
  }

  /**
   * Open a fully-synced document: hydrate the CRDT from the cloud, reconcile
   * whatever is on disk against it, then keep both sides live.
   *
   * `seed` is the document row's markdown, used ONLY when the cloud has no CRDT
   * yet. A document created through the API — how agents, the MCP createDoc tool
   * and the CLI all make them — has its content in the row and no CRDT at all,
   * since the CRDT is only born when something opens the doc. Without the seed we
   * materialized an empty file and then pushed that emptiness up as the CRDT,
   * stranding the row's content and making the doc open empty in the browser too.
   * openEditorDoc has always applied this rule; this is the same one.
   */
  static async open(
    docId: string,
    path: string,
    store: DocStore,
    pubsub: DocPubSub,
    fs: VaultSyncFs,
    baseStore?: VaultBaseStore,
    seed?: string,
    opts: VaultSyncOpenOptions = {}
  ): Promise<VaultSync> {
    const onDisk = fs.read(path);
    const persistedBase = baseStore?.load(docId) ?? null;
    // The one switch a read-only document turns: its session saves through
    // this wrapper, which drops the write while the mode says so. Shared with
    // the instance, so setReadOnly reaches a session that was built before it.
    const mode = { readOnly: opts.readOnly === true };
    const gated: DocStore = {
      load: (id) => store.load(id),
      save: (id, snap) => (mode.readOnly ? Promise.resolve() : store.save(id, snap)),
    };

    // Fetch the cloud snapshot ONCE and use it for both decisions below. It used
    // to be loaded here to answer "is there a CRDT yet", thrown away, then loaded
    // again inside SyncSession.open — two identical network round trips per
    // document, on a path that opens documents serially. SyncSession takes the
    // result precisely so a caller who already has it need not ask twice.
    const loaded = await store.load(docId);

    // Seed only into a void: once a CRDT exists it is the truth, and re-seeding
    // would insert the row's stale content on top of live edits.
    const seedable = seed !== undefined && seed !== "" && loaded === null;
    // Otherwise start empty and let SyncSession hydrate from the cloud CRDT, so
    // the doc carries the authoritative history — never a fresh insert that would
    // duplicate on merge.
    const vaultDoc = new VaultDoc(seedable ? seed : "");
    // Taken BEFORE the file is applied: the shadow must hold the cloud's
    // state, and the seed is the cloud's content the row carried.
    const cloudState = mode.readOnly ? (loaded ?? (seedable ? snapshot(vaultDoc.doc) : null)) : null;
    const session = await SyncSession.open(docId, vaultDoc.doc, gated, pubsub, loaded);

    if (persistedBase !== null) {
      // Restart: the persisted base is the last content both sides shared. Merge
      // the on-disk file against it and the (possibly advanced) cloud CRDT, so an
      // offline disk edit and a concurrent cloud edit both survive.
      vaultDoc.setSyncBase(persistedBase);
      if (onDisk !== null) keepRejected(fs, path, vaultDoc.applyFileContent(onDisk), opts.onConflict);
    } else {
      // First open: treat the hydrated cloud state as the base.
      vaultDoc.markSynced();
      if (onDisk !== null && onDisk !== vaultDoc.markdown()) {
        keepRejected(fs, path, vaultDoc.applyFileContent(onDisk), opts.onConflict);
      }
    }

    // Bring disk in line with the CRDT.
    if (onDisk === null) {
      // File missing (new here, or deleted offline) → materialize / restore it.
      fs.write(path, vaultDoc.markdown());
      vaultDoc.markSynced();
    } else {
      const flushed = vaultDoc.flushToDisk();
      if (flushed.wrote) fs.write(path, flushed.content);
      // A three-way merge above leaves the replica holding text that is on
      // neither side yet — applyFileContent records the merged text as synced,
      // so flushToDisk sees nothing to do, and the file kept the pre-merge text
      // until the next update happened to land. Write what was merged. The
      // same line puts the cloud's text back after a conflict, whose copy of
      // the file's text is already under .conflicts/.
      else if (onDisk !== vaultDoc.markdown()) fs.write(path, vaultDoc.markdown());
    }

    // From now on, any CRDT change the file doesn't have (a cloud/other-client
    // edit) is written to disk. Our own file-origin edits already advanced
    // last-synced, so this no-ops for them.
    // The reconcile above is a one-off merge, not typing: persist it now rather
    // than letting it sit behind the save debounce, so anything that reads the
    // store next — a fresh session, another machine — already sees it.
    session.flush();

    const self = new VaultSync(docId, path, vaultDoc, session, fs, store, mode, baseStore, opts.onConflict);
    if (mode.readOnly) self.raiseShadow(cloudState);
    self.persistBase();
    const onUpdate = () => {
      const r = vaultDoc.flushToDisk();
      if (r.wrote) fs.write(self.path, r.content); // self.path so a rename follows
      self.persistBase();
    };
    vaultDoc.doc.on("update", onUpdate);
    self.detach = () => vaultDoc.doc.off("update", onUpdate);
    return self;
  }

  /** A file change on disk (from the watcher) — absorb it into the CRDT. */
  fileChanged(): void {
    const content = this.fs.read(this.path);
    if (content === null) return;

    // A file that reads as empty is not proof that it IS empty. cp, shell
    // redirection and plenty of editors write by truncating first, leaving a
    // window — sometimes microseconds — where the file is zero bytes. Applying
    // that window empties the document for every client, pushes it to the cloud
    // and records it as a version. That is not hypothetical: it blanked a real
    // document on 2026-09-21, and an identical write minutes earlier had won the
    // race, which is what makes it so easy to dismiss as a one-off.
    //
    // So hold it, and let the sweep decide. A deliberate clear syncs a sweep
    // later instead of instantly — much the cheaper loss of the two.
    if (content === "" && this.vaultDoc.markdown() !== "") {
      this.pendingEmpty = true;
      return;
    }

    this.pendingEmpty = false;
    this.absorb(content);
    this.persistBase();
  }

  /**
   * The file's text into the document — or, when it collides with the cloud's
   * on the same lines, a copy of it under .conflicts/ and the cloud's text back
   * onto the file, so the two sides agree again and nothing is lost.
   */
  private absorb(content: string): void {
    this.noteWriter(content);
    const r = this.vaultDoc.applyFileContent(content);
    if (r.rejected === undefined) return;
    keepRejected(this.fs, this.path, r, this.onConflict);
    this.fs.write(this.path, this.vaultDoc.markdown());
  }

  /**
   * Before a change off the disk is applied: note who made it, and if the
   * writer changed — the person after an agent, an agent after the person,
   * one agent after another — close the version in progress first, so each
   * version is one writer's work as far as that can be known.
   */
  private noteWriter(content: string): void {
    if (!this.tracking || this.credit === null) return;
    if (content === this.vaultDoc.markdown()) return; // our own write, echoed back
    const write = this.credit(content);
    const last = this.pendingWrites[this.pendingWrites.length - 1];
    if (last !== undefined && last.agent !== write.agent) this.recordVersion(Date.now());
    // A document with text but no history yet (a file just adopted): that text
    // was there before the agent wrote, so it gets a version of its own first
    // rather than being folded into the agent's.
    else if (last === undefined && write.agent !== null && this.lastVersionAt === null) {
      this.recordVersion(Date.now());
    }
    // One entry says it all for a run of writes by the same known agent; the
    // rest are kept to ask again, up to a bound a long session cannot outgrow.
    const again = this.pendingWrites[this.pendingWrites.length - 1];
    if (again !== undefined && write.agent !== null && again.agent === write.agent) return;
    if (this.pendingWrites.length >= 200) this.pendingWrites.shift();
    this.pendingWrites.push(write);
  }

  /**
   * Resolve a held empty read; returns whether an EMPTYING was applied.
   *
   * Runs from the manager's sweep, long enough after the fact that a
   * truncate-then-write has certainly finished — so a file still empty by now
   * was emptied on purpose. If the writer has since filled it, that content is
   * what gets applied, which is what the watcher would have done anyway.
   */
  confirmPendingEmpty(): boolean {
    if (!this.pendingEmpty) return false;
    this.pendingEmpty = false;

    const content = this.fs.read(this.path);
    // Gone entirely — that is fileRemoved's business, and it restores from the
    // CRDT rather than losing the content.
    if (content === null) return false;

    this.absorb(content);
    this.persistBase();
    return content === "";
  }

  /** Current CRDT markdown (the source of truth). */
  markdown(): string {
    return this.vaultDoc.markdown();
  }

  /** The document's Y.Doc — versions live in it, beside the content. */
  get doc(): Y.Doc {
    return this.vaultDoc.doc;
  }

  /**
   * Start recording versions for this document, credited to `author`.
   *
   * The PERSON, not the machine: you typed it in Obsidian, and the daemon is
   * transport. `null` still records, just unattributed — a daemon that could not
   * resolve its owner (the app is down, the key was revoked) must not silently
   * stop keeping history, because an unattributed version beats none.
   *
   * Off by default, so a caller with no identity records nothing by accident —
   * the browser runs its own ticker and must not get a second one here.
   */
  trackVersions(author: string | null, credit?: AgentCredit): void {
    this.author = author;
    this.credit = credit ?? null;
    if (this.tracking) return;
    this.tracking = true;

    // Pick up where the cloud left off, so the first local edit isn't mistaken
    // for this document's first version ever. A corrupted entry must not take
    // sync down with it: history then simply starts fresh from here.
    try {
      const already = versionCount(this.doc);
      if (already > 0) {
        this.lastVersionAt = listVersions(this.doc)[already - 1].at;
        this.lastVersionContent = versionContent(this.doc, already - 1);
      }
    } catch {
      // keep syncing regardless — content matters more than its history
    }

    this.detachObserve = observeMarkdown(this.doc, (origin) => {
      this.lastEditAt = Date.now();
      this.lastOrigin = origin;
    });
  }

  /**
   * Record a version if one is due; returns whether it did.
   *
   * `now` is a parameter so the cadence is testable without fake timers, and so
   * one caller can sweep every open document on a single interval.
   *
   * Only edits that came off THIS machine's disk are ours to record. A change
   * that arrived over the bus was written by someone else, on their machine, and
   * crediting it here is exactly the misattribution that filling in the author
   * would otherwise introduce.
   */
  maybeCheckpoint(now: number = Date.now()): boolean {
    if (!this.tracking) return false;
    if (this.lastOrigin !== LOCAL_ORIGIN) return false;
    // A version lives in the Y.Doc, and a read-only replica's Y.Doc goes
    // nowhere: recording one would credit a fork with history the document
    // never gets. Versions start when the saves do.
    if (this.mode.readOnly) return false;

    const content = this.markdown();
    const due = shouldCheckpoint({
      now,
      lastEditAt: this.lastEditAt,
      lastVersionAt: this.lastVersionAt,
      lastVersionContent: this.lastVersionContent,
      content,
    });
    if (!due) return false;

    return this.recordVersion(now);
  }

  /**
   * Cut a version of the document as it stands, credited to the author and to
   * whichever agents wrote the file changes in it. False when there is nothing
   * new to record.
   */
  private recordVersion(now: number): boolean {
    if (this.mode.readOnly) return false;
    const content = this.markdown();
    if (content === this.lastVersionContent) return false;

    // Settle who wrote what: a change not credited when it arrived asks again.
    const agents: string[] = [];
    let person = false;
    for (const write of this.pendingWrites) {
      const agent = write.agent ?? write.later();
      if (agent === null) person = true;
      else if (!agents.includes(agent)) agents.push(agent);
    }
    this.pendingWrites = [];

    const recorded = checkpoint(this.doc, {
      ...(this.author === null ? {} : { author: this.author }),
      ...(agents.length > 0 ? { agents, mixed: person } : {}),
    });
    if (recorded) {
      this.lastVersionAt = now;
      this.lastVersionContent = content;
    }
    return recorded;
  }

  /** Rewrite the file from the CRDT — restores a file deleted on disk in error
   *  (the CRDT is the truth, so content is never lost to an errant delete). */
  restore(): void {
    this.fs.write(this.path, this.vaultDoc.markdown());
  }

  /** Follow a rename/move: the same document now lives at a new path. Later
   *  flushes and file reads use it; the old file is already gone (the OS moved it). */
  rename(newPath: string): void {
    this.path = newPath;
  }

  close(): void {
    this.detach();
    this.detachObserve();
    this.detachShadow();
    this.session.close();
  }
}
