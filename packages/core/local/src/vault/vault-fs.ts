// Node filesystem adapter for the vault (roadmap F1, local half — the real disk).
//
// `NodeVaultFs` implements the injectable `VaultFs` that the content sync needs,
// backed by node:fs and rooted at the vault directory. `listMarkdown`/`syncOnce`
// give a deterministic scan; `watchVault` (fs-watcher.ts) is the live driver. The
// reconcile logic (loop-guard, restore-on-delete, merge) lives in @markbase/docs
// and is unit-tested there; this file is the thin real-fs glue.

import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { baseStoreDir } from "./markbase-home";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import type { VaultFs, VaultBaseStore } from "@markbase/protocol/storage";
import { VAULT_MARKER, markerPathFor, type VaultMarker, GENERATED_DIRS } from "./vault-boundary";
import { emptyIgnore, type VaultIgnore } from "./vault-ignore";

/**
 * Where a vault's device-local sync state lives — OUTSIDE the vault, so a
 * file-drive (iCloud/Obsidian) never syncs one machine's sync base to another
 * (which would be per-device nonsense), the same reason OpenKnowledge shadows its
 * git dir.
 *
 * Keyed by `identity`, which should be the VAULT ID: the vault is the stable
 * thing, the folder is just where it lives today. Keyed by folder path instead,
 * moving or repointing a vault orphaned its base and silently reintroduced the
 * offline clobber A4 exists to prevent.
 */
function shadowStatePath(identity: string, stateDir: string): string {
  const slug = basename(identity).replace(/[^a-zA-Z0-9._-]+/g, "-") || "vault";
  const hash = createHash("sha1").update(identity).digest("hex").slice(0, 12);
  return join(stateDir, `${slug}-${hash}.json`);
}

/**
 * Durable per-doc sync base so a worker restart three-way merges offline edits
 * instead of clobbering them (roadmap F1, A4). Persisted device-locally (see
 * shadowStatePath), small enough to rewrite whole on each save.
 */
export class NodeVaultBaseStore implements VaultBaseStore {
  private readonly file: string;
  private readonly bases: Record<string, string>;

  /**
   * `identity` should be the vault id, so the base survives the vault moving to a
   * new folder. The legacy single-vault case has no id and passes its folder
   * path, which still works — it just doesn't survive a move.
   */
  constructor(
    identity: string,
    stateDir: string = baseStoreDir()
  ) {
    this.file = shadowStatePath(identity, stateDir);
    let loaded: Record<string, string> = {};
    if (existsSync(this.file)) {
      try {
        loaded = JSON.parse(readFileSync(this.file, "utf8")) as Record<string, string>;
      } catch {
        loaded = {}; // corrupt/partial file → start fresh; the CRDT is still the truth
      }
    }
    this.bases = loaded;
  }

  load(docId: string): string | null {
    return this.bases[docId] ?? null;
  }

  save(docId: string, base: string): void {
    this.bases[docId] = base;
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(this.bases));
  }
}

export class NodeVaultFs implements VaultFs {
  constructor(private readonly root: string) {}

  private abs(p: string): string {
    return join(this.root, p);
  }

  read(p: string): string | null {
    const a = this.abs(p);
    return existsSync(a) ? readFileSync(a, "utf8") : null;
  }

  write(p: string, content: string): void {
    const a = this.abs(p);
    mkdirSync(dirname(a), { recursive: true });
    // A file this daemon holds read-only (see setReadOnly) is still ours to
    // write: a cloud update lands in it. Open it for the write and close it
    // again, rather than failing on the mode we set ourselves.
    const ro = this.isReadOnly(p);
    if (ro) chmodSync(a, 0o644);
    try {
      writeFileSync(a, content);
    } finally {
      if (ro) chmodSync(a, 0o444);
    }
  }

  /**
   * Mark a file read-only (0444) or writable again (0644) — the before-the-fact
   * signal that a shared document is not the person's to edit: an editor asks
   * "overwrite?", an agent's write tool reports a permission error. Mode bits,
   * not an ACL, so a person who means it gets through, and the daemon treats
   * what they wrote as a fork (docs/shared-vault.md). No-op on a missing file.
   */
  setReadOnly(p: string, readOnly: boolean): void {
    const a = this.abs(p);
    const st = statSync(a, { throwIfNoEntry: false });
    if (!st || !st.isFile()) return;
    const isRo = (st.mode & 0o222) === 0;
    if (isRo === readOnly) return;
    chmodSync(a, readOnly ? 0o444 : 0o644);
  }

  /** Whether a file carries no write bit at all — the mark setReadOnly leaves. */
  isReadOnly(p: string): boolean {
    const st = statSync(this.abs(p), { throwIfNoEntry: false });
    return !!st && st.isFile() && (st.mode & 0o222) === 0;
  }

  rename(from: string, to: string): void {
    const dest = this.abs(to);
    mkdirSync(dirname(dest), { recursive: true });
    renameSync(this.abs(from), dest);
  }

  inode(p: string): number | null {
    return statSync(this.abs(p), { throwIfNoEntry: false })?.ino ?? null;
  }

  /** Retire a file to `<root>/.trash/<path>` — never a hard delete. */
  trash(p: string): void {
    const a = this.abs(p);
    if (!existsSync(a)) return;
    const dest = join(this.root, ".trash", p);
    mkdirSync(dirname(dest), { recursive: true });
    renameSync(a, dest);
  }
}

/**
 * Is this a file we sync? A vault is a folder of markdown, and everything else in
 * it — images, PDFs, .DS_Store, an Obsidian workspace — is somebody else's data we
 * happen to be sitting next to.
 *
 * The startup scan and the live watcher MUST agree here. They didn't: the scan
 * filtered and the watcher took anything, so a PNG dropped into a running vault
 * was read as UTF-8 and adopted as a document of mojibake — while the same PNG
 * present at startup was correctly ignored.
 */
export function isMarkdownPath(path: string): boolean {
  return /\.md$/i.test(path);
}

/** Relative paths of every `.md` under `root`, skipping dotfiles and dot-dirs. */
export function listMarkdown(root: string, ignore?: VaultIgnore): string[] {
  const rules = ignore ?? emptyIgnore();
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue; // .trash, .git, .markbase, …
      const rel = relative(root, join(dir, entry.name)).split(sep).join("/");
      // The vault's own rules. Without them, fall back to the old constant so a
      // caller that has no folder to read still refuses to walk node_modules.
      if (ignore ? rules.ignores(rel, entry.isDirectory()) : entry.isDirectory() && GENERATED_DIRS.has(entry.name))
        continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (isMarkdownPath(entry.name)) out.push(relative(root, full).split(sep).join("/"));
    }
  };
  walk(root);
  return out;
}


/**
 * Write the marker that makes `dir` this vault's root. It travels with the folder,
 * so if the user drags the vault somewhere else — even inside another vault — the
 * other daemon can still tell the subtree isn't its business.
 */
export function writeVaultMarker(dir: string, vaultId: string, ownerId?: string): void {
  const file = markerPathFor(dir);
  mkdirSync(dirname(file), { recursive: true });
  // An owner already on disk survives a write that does not name one: the
  // daemon rewrites the marker on every start, and a start that could not
  // resolve its key's owner (offline) must not erase the account the folder
  // belongs to — that field is the whole defence.
  const existing = readVaultMarkerInfo(dir);
  const owner = ownerId ?? (existing?.vaultId === vaultId ? existing.ownerId : undefined);
  const marker: VaultMarker = owner ? { vaultId, ownerId: owner } : { vaultId };
  writeFileSync(file, JSON.stringify(marker, null, 2) + "\n");
}

/** Which vault is rooted at `dir`, per its marker — or null if it isn't a root. */
export function readVaultMarker(dir: string): string | null {
  return readVaultMarkerInfo(dir)?.vaultId ?? null;
}

/** The whole marker — the vault, and the account that mounted it, if recorded. */
export function readVaultMarkerInfo(dir: string): VaultMarker | null {
  const file = markerPathFor(dir);
  if (!existsSync(file)) return null;
  try {
    const m = JSON.parse(readFileSync(file, "utf8")) as VaultMarker;
    if (typeof m.vaultId !== "string") return null;
    return typeof m.ownerId === "string" ? { vaultId: m.vaultId, ownerId: m.ownerId } : { vaultId: m.vaultId };
  } catch {
    return null; // unreadable marker: treat as not-a-vault rather than crash
  }
}

/** True when the vault root is gone or no longer ours — the daemon must stop
 *  rather than "restore" thousands of files the user simply moved. */
export function vaultRootIntact(dir: string, vaultId: string): boolean {
  return existsSync(dir) && readVaultMarker(dir) === vaultId;
}

export { VAULT_MARKER };
