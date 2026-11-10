// What a file in the vault looks like to the vault.
//
// The vault owns the container: mounting and unmounting, the lock, which files
// exist, what appears and disappears on disk, and the nesting rules. It does not
// own what is *in* a file — that is content, and today's only content type is a
// markdown document synced as a CRDT by @markbase/docs.
//
// Before this interface existed, the vault imported VaultSync from docs directly,
// so a core package depended on a feature. The dependency is now the other way
// around: the vault says what it needs from a synced file, and docs supplies an
// implementation. A second content type — an agent's memories, a plugin's own
// store — implements the same shape without the vault changing.
//
// Deliberately not generic. Making the payload a type parameter today would be
// speculative: documents are the only implementation, and the plugin plan warns
// against building for plugins before the kernel exists.

/** One file the vault tracks, bound to whatever keeps its contents in sync. */
export interface SyncedFile {
  /** The cloud identity this file is bound to. Never the path — a move keeps it. */
  readonly docId: string;
  /** Vault-relative path. Mutated by `rename`, so a flush follows the file. */
  path: string;

  /** The watcher saw a write. Absorb it, or ignore it as our own echo. */
  fileChanged(): void;

  /**
   * The current contents, for the vault's own bookkeeping — telling a move from
   * a new file, and a duplicate from real material. The vault never interprets
   * this, it only compares it.
   */
  content(): string;

  /** Rewrite the file from the source of truth, after an errant delete. */
  restore(): void;

  /** Follow a rename: the same file now lives at a new path. */
  rename(newPath: string): void;

  /** Stop syncing. The file on disk is the vault's business, not this one's. */
  close(): void;

  /**
   * Start recording history, credited to `author` — a person, not the machine.
   * Null still records, unattributed.
   *
   * Versioning is content semantics on a container-owned interface, which is the
   * one seam that leaks. The split that makes it defensible: the vault owns the
   * clock (it runs the sweep), the implementation owns the policy (whether a
   * version is due).
   */
  trackVersions(author: string | null): void;

  /** The sweep ticked. Record a version if one is due; returns whether it did. */
  maybeCheckpoint(now?: number): boolean;

  /**
   * Settle a held empty read. A file that reads as zero bytes may be mid-write
   * (cp truncates before writing), so the vault holds it and asks again later.
   * Returns whether an emptying was applied.
   */
  confirmPendingEmpty(): boolean;

  // ---- Read-only files, and the fork an edit to one becomes ----------------
  // The Shared Vault (docs/shared-vault.md) holds documents the person may
  // only read. Their file is written read-only, and an edit made to it anyway
  // is kept as a live fork: applied, merged with what the cloud sends, never
  // sent up. Optional: a content type that cannot be forked leaves them out,
  // and the vault treats every file of it as writable.

  /** Whether writes to the source of truth are held back. */
  readonly readOnly?: boolean;
  /** Hold back (or resume) writes to the source of truth. Resuming sends what was held. */
  setReadOnly?(readOnly: boolean): void;
  /** The file carries edits the source of truth has not got. Only ever true while read-only. */
  hasLocalEdits?(): boolean;
  /** The source of truth's content, for comparison with the fork. Null when writable. */
  cloudContent?(): string | null;
  /** Drop every local-only edit: the file goes back to the source of truth. */
  discardLocalEdits?(): boolean;
}

/**
 * How the vault opens one.
 *
 * Takes only what the vault knows — identity, path, and the row's seed markdown
 * for a document the cloud has no CRDT for yet. Transport and storage are the
 * implementation's business, closed over by whoever supplies this.
 */
export type OpenSyncedFile = (args: {
  docId: string;
  path: string;
  /** The document row's contents, used only when the cloud has nothing yet. */
  seed?: string;
  /** Open it read-only — see the trailing members of SyncedFile. */
  readOnly?: boolean;
}) => Promise<SyncedFile>;
