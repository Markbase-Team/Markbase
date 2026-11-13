// The one place the vault knows that a file's contents are a CRDT document.
//
// This is the whole point of the SyncedFile seam: the container (VaultSyncManager,
// the watcher, the lock, the registry) is written against an interface, and this
// single file is the adapter that satisfies it with @markbase/docs. Everything
// else in the package is content-agnostic.
//
// Keeping the adapter HERE rather than in docs is deliberate. Docs is a feature
// package and the vault is core, so docs may depend on the vault — but the
// implementation that docs would have to export is a five-line rename, and
// exporting it would make docs import the vault's interface purely to satisfy a
// naming difference. The composition root is the honest home for wiring.
//
// What this costs: @markbase/docs is still a dependency of @markbase/vault, via
// this file and the Supabase transport in vault-sync-run.ts. What it buys: the
// dependency is now one named adapter instead of a class woven through the
// manager's routing, so a second content type is a second adapter, not a rewrite.

import {
  VaultSync,
  type DocStore,
  type DocPubSub,
} from "@markbase/docs";
import type { VaultSyncFs, VaultBaseStore } from "@markbase/protocol/storage";
import type { AgentCredit, AgentReads, OpenSyncedFile, SyncedFile } from "./synced-file";

/**
 * A CRDT document, wearing the vault's interface.
 *
 * A wrapper rather than a structural cast: `markdown()` is the doc engine's word
 * for it, `content()` is the vault's, and the vault must not inherit the former
 * just because today's only implementation happens to be markdown. `path` is
 * proxied through because a rename mutates it and later flushes read it back.
 */
class DocsSyncedFile implements SyncedFile {
  constructor(private readonly vs: VaultSync) {}

  get docId(): string {
    return this.vs.docId;
  }
  get path(): string {
    return this.vs.path;
  }
  set path(p: string) {
    this.vs.path = p;
  }

  content(): string {
    return this.vs.markdown();
  }
  fileChanged(): void {
    this.vs.fileChanged();
  }
  restore(): void {
    this.vs.restore();
  }
  rename(newPath: string): void {
    this.vs.rename(newPath);
  }
  close(): void {
    this.vs.close();
  }
  trackVersions(author: string | null, credit?: AgentCredit): void {
    this.vs.trackVersions(author, credit);
  }
  recordAgentReads(reads: AgentReads[]): void {
    this.vs.recordAgentReads(reads);
  }
  maybeCheckpoint(now?: number): boolean {
    return this.vs.maybeCheckpoint(now);
  }
  confirmPendingEmpty(): boolean {
    return this.vs.confirmPendingEmpty();
  }

  get readOnly(): boolean {
    return this.vs.readOnly;
  }
  setReadOnly(readOnly: boolean): void {
    this.vs.setReadOnly(readOnly);
  }
  hasLocalEdits(): boolean {
    return this.vs.hasLocalEdits();
  }
  cloudContent(): string | null {
    return this.vs.cloudMarkdown();
  }
  discardLocalEdits(): boolean {
    return this.vs.discardLocalEdits();
  }
}

/**
 * Build the factory the vault opens files with, closing over the cloud transport.
 *
 * The manager never sees `store`, `pubsub` or `baseStore` — that is the seam.
 * They are transport and persistence details of *this* content type, and a
 * content type that needed neither would supply an opener that closes over
 * nothing at all.
 */
export function docsSyncedFiles(
  store: DocStore,
  pubsub: DocPubSub,
  fs: VaultSyncFs,
  baseStore?: VaultBaseStore,
  log?: (message: string) => void
): OpenSyncedFile {
  return async ({ docId, path, seed, readOnly }) => {
    const vs = await VaultSync.open(docId, path, store, pubsub, fs, baseStore, seed, {
      readOnly,
      // The one thing a conflict needs from the host: a line in its log. The
      // file took the cloud's text; the person's own is in the copy.
      onConflict: ({ path: file, copy }) =>
        log?.(`${file} changed here and in the cloud on the same lines — the cloud's text is in the file, yours is in ${copy}`),
    });
    return new DocsSyncedFile(vs);
  };
}
