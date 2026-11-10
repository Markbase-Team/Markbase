// Media on disk (roadmap A6, daemon half).
//
// The markdown says `![d](assets/d.png)`. For that to mean anything locally the
// FILE has to be there — that's the whole promise of "your vault is a folder":
// open it in Obsidian, offline, and the images render.
//
// Unlike a document, an asset is opaque bytes: no CRDT, no merge, no three-way
// anything. It is simply present or not, which makes the reconcile a plain diff —
// and makes the CONTENT HASH the only honest way to compare, since a name and a
// size say nothing about what a file contains.

import { createHash } from "node:crypto";
import { GENERATED_DIRS } from "./vault-boundary";
import type { VaultIgnore } from "./vault-ignore";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, sep } from "node:path";

/** An asset as the cloud knows it. */
export interface CloudAsset {
  path: string;
  sha256: string;
}

/** An asset as the folder has it. */
export interface DiskAsset {
  path: string;
  sha256: string;
}

export interface AssetPlan {
  /** Fetch these and write them to disk. */
  download: CloudAsset[];
  /** Local files the cloud doesn't have these bytes for — send them up. */
  upload: string[];
}

/**
 * Diff the cloud's assets against the folder's.
 *
 * Note what's absent: a `delete`. An asset missing from the cloud does NOT mean
 * "remove the local file". A document deleted by mistake comes back from its CRDT;
 * an asset has no such safety net, because the bytes exist only where they exist.
 * Deleting someone's original image because a row vanished is unrecoverable, so
 * the answer is to upload it instead — the exact reverse of destructive.
 */
export function planAssetSync(cloud: CloudAsset[], disk: DiskAsset[]): AssetPlan {
  const onDisk = new Map(disk.map((d) => [d.path, d.sha256]));
  const inCloud = new Map(cloud.map((c) => [c.path, c.sha256]));

  // Missing locally, or the same path now holds different bytes.
  const download = cloud.filter((c) => onDisk.get(c.path) !== c.sha256);
  const upload = disk.filter((d) => inCloud.get(d.path) !== d.sha256).map((d) => d.path);

  return { download, upload };
}

/** Hex sha256 — the same content address the cloud keys objects by. */
export function hashFile(absPath: string): string {
  return createHash("sha256").update(readFileSync(absPath)).digest("hex");
}

/** Extension → content type. Keep in step with isAssetPath. */
const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  avif: "image/avif",
  bmp: "image/bmp",
  ico: "image/x-icon",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  m4a: "audio/mp4",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  pdf: "application/pdf",
};

/**
 * What kind of file this is, judged by its extension.
 *
 * The browser gets this free — a pasted File carries its type. A disk stores no
 * such thing, so the daemon has only the name to go on: without this an uploaded
 * image landed as application/octet-stream, and a signed URL served the user's
 * picture as a download.
 */
export function mimeForPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return (ext !== path.toLowerCase() && MIME[ext]) || "application/octet-stream";
}

/** Is this a file we carry as an asset rather than a document? */
export function isAssetPath(path: string): boolean {
  return /\.(png|jpe?g|gif|webp|svg|avif|bmp|ico|mp4|webm|mov|m4a|mp3|wav|pdf)$/i.test(path);
}

/**
 * What we last hashed at a path, so an unchanged file is never read twice.
 *
 * Keyed by PATH, because that is what the plan compares and what a caller asks
 * about. Two files with identical bytes at different paths are two assets; the
 * same path holding new bytes is one asset that changed.
 */
export interface AssetHash {
  mtimeMs: number;
  size: number;
  sha256: string;
}
export type AssetHashMemo = Map<string, AssetHash>;

/**
 * Every asset file in the vault, hashed. Dot-directories are skipped for the same
 * reason the document scan skips them: `.git` and `.trash` are not the user's
 * media, and `.trash` especially must never be re-uploaded as if it were live.
 *
 * Pass a `memo` — owned by the caller, living across passes — to skip re-reading
 * files that have not changed. This runs on the reconcile interval, every 15
 * seconds for as long as a vault is mounted, and hashing means reading the WHOLE
 * file: a folder with 3,179 media files was re-reading 791 MB four times a
 * minute, roughly 190 GB an hour, to recompute digests that had not changed.
 *
 * `stat` is the detector (11 ms across those 3,179 files); the hash stays the
 * identity (952 ms). Nothing about HOW the plan compares content changes — only
 * how often the digest is recomputed.
 *
 * (mtime, size) is a heuristic, not a proof: a file edited to exactly the same
 * size while keeping its mtime is missed. That takes deliberate effort on a
 * nanosecond-resolution filesystem, it is the same bet git and rsync make, and
 * two things catch it anyway — the memo is in memory, so a restart re-reads
 * everything, and the watcher fires on the file itself, so a change is seen as an
 * event and not only as a comparison.
 */
export function listDiskAssets(
  root: string,
  memo?: AssetHashMemo,
  ignore?: VaultIgnore
): DiskAsset[] {
  const out: DiskAsset[] = [];
  const seen = new Set<string>();
  const walk = (dir: string): void => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      // The SAME rule the markdown walker uses. Missing it here uploaded 15 MB of
      // Android build intermediates — beauty-filter PNGs out of
      // app/build/intermediates — as vault assets. Two walkers over one folder
      // have to agree on what the folder contains.
      const rel = relative(root, join(dir, entry.name)).split(sep).join("/");
      // Both walkers over one folder must agree on what the folder contains;
      // missing this here uploaded 15 MB of Android build intermediates.
      if (ignore ? ignore.ignores(rel, entry.isDirectory()) : entry.isDirectory() && GENERATED_DIRS.has(entry.name))
        continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!isAssetPath(entry.name)) continue;
      const path = relative(root, full).split(sep).join("/");
      seen.add(path);
      out.push({ path, sha256: hashCached(full, path, memo) });
    }
  };
  walk(root);
  // Drop what is no longer there. Without this the memo grows for the life of the
  // daemon, and a path deleted then recreated could be answered from the entry the
  // old file left behind.
  if (memo) for (const path of memo.keys()) if (!seen.has(path)) memo.delete(path);
  return out;
}

/** The memo lookup: stat, compare, and read the file only when it has moved on. */
function hashCached(full: string, path: string, memo?: AssetHashMemo): string {
  if (!memo) return hashFile(full);
  let st;
  try {
    st = statSync(full);
  } catch {
    return hashFile(full); // vanished mid-walk; let the read report it
  }
  const prev = memo.get(path);
  if (prev && prev.mtimeMs === st.mtimeMs && prev.size === st.size) return prev.sha256;
  const sha256 = hashFile(full);
  memo.set(path, { mtimeMs: st.mtimeMs, size: st.size, sha256 });
  return sha256;
}

/** Write asset bytes into the vault, creating the folder it lives in. */
export function writeAsset(root: string, path: string, bytes: Uint8Array): void {
  const abs = join(root, path);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, bytes);
}

/** Read an asset's bytes for upload, or null if it vanished mid-sync. */
export function readAsset(root: string, path: string): Uint8Array | null {
  const abs = join(root, path);
  return existsSync(abs) ? new Uint8Array(readFileSync(abs)) : null;
}
