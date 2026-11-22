// What storage looks like — declared once, for everyone who touches a vault.
//
// Three interfaces describing reading and writing files, and remembering what
// disk and cloud last agreed on. Nothing about them is CRDT-shaped: read, write,
// trash, load, save.
//
// They lived in @markbase/docs, because the first implementation of a synced
// file did — which pointed the dependency the wrong way, the container asking a
// feature what a filesystem is. Moving them to the vault only inverted the
// problem: the vault already imports docs (the CRDT adapter, the Supabase
// transport), so docs importing the vault back would close a cycle.
//
// Protocol is the one place both can depend on, which is why folders.ts lives
// here for exactly the same reason. There is no node import in this file and
// there must never be one — the browser reaches this package's entry.
//
// Implementations: NodeVaultFs and NodeVaultBaseStore (@markbase/vault's
// vault-fs.ts), and the inline VaultFs the daemon builds. Docs consumes them.

/** The disk surface a synced folder needs. `trash` retires, never hard-deletes. */
export interface VaultFs {
  /** File contents, or null if it doesn't exist. */
  read(path: string): string | null;
  write(path: string, content: string): void;
  /** Retire a file (move to .trash) — never a hard delete. */
  trash(path: string): void;
  /**
   * Move a file, keeping its identity (inode) and leaving nothing behind. A
   * document whose title changed is renamed, not rewritten and retired: a
   * folder full of .trash copies of every intermediate title is not a rename.
   * Optional: without it a move is a write at the new path and a trash of the old.
   */
  rename?(from: string, to: string): void;
  /**
   * The file's inode, or null if it doesn't exist. A rename keeps the inode
   * while the name and (if the user edited on the way) the bytes change, so it
   * is how a synced folder tells "the same file, renamed" from "a new file".
   * Optional: an in-memory fs has no inodes and gets content matching instead.
   */
  inode?(path: string): number | null;
}

/** The narrower surface one synced file needs: no trash, it never deletes. */
export interface VaultSyncFs {
  /** File contents, or null if the file doesn't exist. */
  read(path: string): string | null;
  write(path: string, content: string): void;
}

/**
 * Durable per-file sync base — the last content disk and cloud shared.
 *
 * Persisted by the vault (a small state file outside the vault directory, so a
 * file-drive never syncs one machine's base to another) so a restart three-way
 * merges offline edits instead of clobbering them. Optional: without it, a
 * synced file treats the hydrated cloud state as the base.
 */
export interface VaultBaseStore {
  load(docId: string): string | null;
  save(docId: string, base: string): void;
}
