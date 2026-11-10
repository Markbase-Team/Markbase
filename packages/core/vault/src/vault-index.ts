// What a vault folder knows about itself: which document each file is.
//
// The files on disk carry the CONTENT but not the IDENTITY. `notes/foo.md` has
// no idea which cloud document it is, and the CRDT is keyed by document id — so
// listing a vault, or opening a file from it, needed a round trip to the API
// just to learn the mapping. That is what kept a local-first read path out of
// reach: the bytes were already here, the names for them were not.
//
// The daemon already computes this mapping every time it reconciles (it has to,
// to decide which file each document belongs in). This writes it down.
//
// It lives at <vault>/.markbase/index.json, beside the vault marker, so it
// travels with the folder and is restored by any backup that keeps it. The
// watcher already ignores everything under .markbase except the marker itself,
// so writing it can never look like a file edit and start a sync loop.
//
// It is a CACHE, never a source of truth: the cloud decides what exists, and a
// missing or stale index costs a network round trip, nothing more. Nothing is
// deleted on the strength of it.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** One document, as the vault folder knows it. */
export interface VaultIndexEntry {
  id: string;
  title: string;
  /**
   * The document's own path, as the cloud stores it ("projects/q1.md"), or null
   * for a document created before paths existed. This is what a tree groups by.
   */
  path: string | null;
  /**
   * The file it actually occupies HERE. Usually the same as `path`, but two
   * documents wanting one filename get an id suffix, so this is the one to
   * resolve a file on disk back to a document.
   */
  file: string;
  /**
   * That file's inode when the index was written. A rename made while no daemon
   * was watching keeps it, so the next start can tell a renamed document from
   * a new file plus a deleted one. Absent when the index predates it.
   */
  ino?: number;
  version: number;
  updated_at: string;
  /**
   * The Shared Vault only (docs/shared-vault.md): what the person holds on a
   * document someone shared with them. Absent in an owned vault, where every
   * file is the owner's.
   */
  capability?: "editor" | "commenter" | "viewer";
  /**
   * The file carries edits the cloud has not got — a viewer's or commenter's
   * file was edited anyway, and the daemon keeps the fork alive rather than
   * sending it up (it may not) or overwriting it (it must not). `since` is
   * when the fork was first noticed; it is carried across restarts so the host
   * notifies once, not once per launch, and the fork never expires on its own.
   */
  fork?: { since: string };
}

export interface VaultIndex {
  /** Bumped when the shape changes; an index from the future is ignored. */
  version: 1;
  vaultId: string;
  /** When the daemon last wrote this, so a reader can judge its age. */
  updatedAt: string;
  docs: VaultIndexEntry[];
}

const INDEX_VERSION = 1;

/** Where a vault folder keeps its index. */
export function vaultIndexPath(vaultDir: string): string {
  return join(vaultDir, ".markbase", "index.json");
}

/**
 * The index for a vault folder, or null when there isn't a usable one — never
 * mounted, never synced, or written by a newer version than this code knows.
 */
export function readVaultIndex(vaultDir: string): VaultIndex | null {
  try {
    const raw = JSON.parse(readFileSync(vaultIndexPath(vaultDir), "utf8")) as VaultIndex;
    if (raw.version !== INDEX_VERSION || !Array.isArray(raw.docs)) return null;
    return raw;
  } catch {
    return null; // absent or unreadable — the caller asks the network instead
  }
}

/** Write the index for a vault folder. Best-effort: never fails a sync. */
export function writeVaultIndex(
  vaultDir: string,
  vaultId: string,
  docs: VaultIndexEntry[]
): void {
  try {
    const path = vaultIndexPath(vaultDir);
    mkdirSync(dirname(path), { recursive: true });
    const index: VaultIndex = {
      version: INDEX_VERSION,
      vaultId,
      updatedAt: new Date().toISOString(),
      docs,
    };
    writeFileSync(path, JSON.stringify(index, null, 2) + "\n");
  } catch {
    // Losing the index costs a round trip next time, never correctness.
  }
}

/** Which document a file in this vault holds, or null if the index doesn't say. */
export function docIdForFile(index: VaultIndex, file: string): string | null {
  const want = file.replace(/\\/g, "/").replace(/^\.\//, "");
  return index.docs.find((d) => d.file === want)?.id ?? null;
}
