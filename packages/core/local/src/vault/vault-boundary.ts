// Vault boundaries — keeping one vault out of another's business.
//
// Vaults must not nest: two sync roots overlapping means two daemons claim the
// same file, each publishing the other's writes into a different CRDT. But a user
// can simply drag ~/Personal into ~/Work, and any defense keyed on CONFIG fails —
// the config still says ~/Personal while the folder is somewhere else entirely.
//
// So vault-ness is marked ON DISK, in a file that travels with the folder:
//
//     <vault>/.markbase/vault.json   →  { "vaultId": "…" }
//
// The outer daemon walks a file's ancestors; if any directory below its own root
// carries someone else's marker, that subtree isn't its business — skip it, the
// way git refuses to swallow a nested repository. This handles all three cases
// with one rule: a vault dragged in, a vault created in place, and a vault deleted
// (its marker goes, and the files become ordinary files again).

import { join, resolve, sep } from "node:path";
import { IGNORE_FILE, type VaultIgnore } from "./vault-ignore";

/** The file that makes a directory a vault root. Relative to the vault folder. */
export const VAULT_MARKER = ".markbase/vault.json";

export interface VaultMarker {
  vaultId: string;
  /**
   * The account that mounted this vault — the user id the daemon's key
   * resolved to the first time it synced the folder under the account-bound
   * scheme. Absent on a folder mounted before owners were recorded; the next
   * successful sync writes it, once the API confirms the vault is the caller's.
   *
   * It is what keeps one account's daemon out of another account's folder.
   * On 2026-10-30 the desktop app was signed out and into a second account on
   * the same Mac; the registry is machine-wide, so every folder was mounted
   * for the new key, listed as empty (not that account's vaults), and every
   * file in it was uploaded as a new document into the first account's vault.
   * A key whose owner differs from this field refuses to sync the folder.
   */
  ownerId?: string;
}

/** Absolute path of a vault folder's marker. */
export function markerPathFor(vaultDir: string): string {
  return join(vaultDir, VAULT_MARKER);
}

/** Vault-relative, POSIX separators, no empty or "." segments. */
function relSegments(relPath: string): string[] {
  return relPath.replace(/\\/g, "/").split("/").filter((s) => s !== "" && s !== ".");
}

/**
 * If `relPath` IS a vault marker, the folder it marks ("" when it's our own root
 * marker); otherwise null.
 *
 * A vault can be born inside ours — the user picks a subfolder and makes it a
 * vault while we're running — and a marker file appearing is the only evidence.
 */
export function markerDirOf(relPath: string): string | null {
  const norm = relSegments(relPath).join("/");
  if (norm === VAULT_MARKER) return "";
  return norm.endsWith(`/${VAULT_MARKER}`) ? norm.slice(0, -(VAULT_MARKER.length + 1)) : null;
}

/**
 * The rules a vault used to have no say in.
 *
 * These names now live in `.markbaseignore` at the vault root (see
 * vault-ignore.ts), seeded from DEFAULT_IGNORE the first time a vault syncs. The
 * set stays here only so the two places that cannot read a file — a caller with
 * a path and no vault folder — keep the behaviour they had.
 *
 * The history: pointing a vault at a code repo walked into node_modules and
 * adopted 735 dependency READMEs as cloud documents. A fixed list fixed that
 * repo and no other, which is why it became a file you can edit.
 *
 * @deprecated Pass a VaultIgnore instead; this is the fallback, not the rule.
 */
export const GENERATED_DIRS = new Set([
  "node_modules",
  "vendor",
  "__pycache__",
  "site-packages",
  "Pods",
  "bower_components",
  "dist",
  "build",
  "out",
  "target",
]);

/**
 * Should the vault watcher ignore this (vault-relative) path? Dot-directories are
 * noise a vault folder collects — .git, .trash, .obsidian, .DS_Store — with one
 * exception: the marker that announces a vault boundary. Ignoring every dotted
 * path dropped the very event that says "this subtree is no longer yours", so the
 * marker (and the directory we must descend into to reach it) stays watched.
 *
 * Everything else is the vault's own `.markbaseignore`. Pass its compiled rules;
 * without them this falls back to GENERATED_DIRS, so a caller that has no folder
 * to read still refuses to walk into node_modules.
 */
export function ignoredByWatcher(relPath: string, ignore?: VaultIgnore): boolean {
  const [markerDir, markerFile] = VAULT_MARKER.split("/");
  const segs = relSegments(relPath);
  // The rules file is dotted, so the rule below would hide it — and a file the
  // user is meant to edit has to be one we can see change. Only at the root: a
  // `.markbaseignore` deeper in the tree belongs to something else.
  if (segs.length === 1 && segs[0] === IGNORE_FILE) return false;
  for (let i = 0; i < segs.length; i++) {
    if (!ignore && GENERATED_DIRS.has(segs[i])) return true;
    if (!segs[i].startsWith(".")) continue;
    if (segs[i] === markerDir) {
      // ".markbase" itself (so a walk descends), or ".markbase/vault.json".
      if (i === segs.length - 1) continue;
      if (i === segs.length - 2 && segs[i + 1] === markerFile) continue;
    }
    return true;
  }
  return ignore ? ignore.ignores(relPath) : false;
}

/** Normalize a directory for comparison: absolute, no trailing separator. */
function normalizeDir(p: string): string {
  const abs = resolve(p);
  return abs.length > 1 && abs.endsWith(sep) ? abs.slice(0, -1) : abs;
}

/**
 * Do two vault folders overlap — same folder, or one inside the other? Used to
 * refuse an overlapping vault at config time, before any damage.
 *
 * Segment-aware: "/Work" must not look like a parent of "/Workshop".
 */
export function pathsOverlap(a: string, b: string): boolean {
  const na = normalizeDir(a);
  const nb = normalizeDir(b);
  return na === nb || na.startsWith(nb + sep) || nb.startsWith(na + sep);
}

/** A vault mounted on this machine: which vault, and where it lives here. */
export interface MountedVaultRef {
  vaultId: string;
  name: string;
  dir: string;
}

/**
 * Which way two folders overlap. The caller has to tell someone what they did
 * wrong, and "inside (or contains)" — the old wording — hedged because this
 * type did not know. They are different mistakes with different remedies:
 * a folder INSIDE a vault holds files that vault already owns (converting it is
 * the operation the user wanted), while a folder that CONTAINS one is simply
 * too wide and wants narrowing.
 */
export type OverlapRelation = "inside" | "contains" | "same";

/** May a vault mount at a folder? `ok: false` carries what to tell the user. */
export type MountVerdict =
  | { ok: true }
  | { ok: false; reason: "other-vault"; vaultId: string }
  | {
      ok: false;
      reason: "overlaps";
      relation: OverlapRelation;
      clashName: string;
      clashDir: string;
    };

/** How `dir` sits relative to `other` — both already known to overlap. */
function relationTo(dir: string, other: string): OverlapRelation {
  const a = normalizeDir(dir);
  const b = normalizeDir(other);
  if (a === b) return "same";
  return a.startsWith(b + sep) ? "inside" : "contains";
}

/**
 * May `vaultId` sync to `dir`? Shared by the CLI and the desktop app so both
 * refuse — and allow — exactly the same things.
 *
 * A blanket "never overlap" is too blunt: it refuses the repair a user most needs.
 * Drag ~/Personal into ~/Work and Personal is still Personal — its marker travelled
 * with the folder and says so. Identity beats location: if the folder declares
 * itself to be this vault, believe it and point the mount at where it actually is.
 * The outer vault's daemon already skips the subtree, so nothing is double-owned.
 *
 * Only an UNMARKED folder overlapping another vault is refused: that folder is
 * part of that vault's tree, and making it a second sync root would give two
 * daemons one file. Turning it into a vault of its own is a convert, not a mount.
 */
export function checkMount(
  dir: string,
  vaultId: string,
  mounted: MountedVaultRef[],
  markerOf: (dir: string) => string | null
): MountVerdict {
  const marker = markerOf(dir);
  if (marker !== null) {
    return marker === vaultId ? { ok: true } : { ok: false, reason: "other-vault", vaultId: marker };
  }
  const clash = mounted.find((m) => m.vaultId !== vaultId && pathsOverlap(dir, m.dir));
  if (clash) {
    return {
      ok: false,
      reason: "overlaps",
      relation: relationTo(dir, clash.dir),
      clashName: clash.name,
      clashDir: clash.dir,
    };
  }
  return { ok: true };
}

/**
 * Is `relPath` (relative to our vault root) inside a vault that isn't ours?
 * Returns that nested vault's folder — also relative to our root — or null.
 *
 * `markerOf(relDir)` returns the vault id rooted at a directory, or null. Our own
 * root ("") is skipped: it carries our marker, and that must not make every file
 * of ours look foreign. Only directories can mark a vault, so the file's own name
 * is never consulted. The OUTERMOST boundary wins — once a subtree isn't ours,
 * what's nested deeper inside it is not our problem either.
 */
export function nestedVaultFor(
  relPath: string,
  markerOf: (relDir: string) => string | null,
  myVaultId: string
): string | null {
  const segs = relSegments(relPath);
  let acc = "";
  // Stop before the last segment: that's the file itself, not a directory.
  for (let i = 0; i < segs.length - 1; i++) {
    acc = acc ? `${acc}/${segs[i]}` : segs[i];
    const id = markerOf(acc);
    if (id !== null && id !== myVaultId) return acc;
  }
  return null;
}
