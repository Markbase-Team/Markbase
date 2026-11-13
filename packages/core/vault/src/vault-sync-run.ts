// The live CRDT vault engine (roadmap F1 / C2) — shared by the `markbase
// vault-sync` CLI and the desktop app's main process.
//
// Enumerates the user's documents, opens a VaultSync per doc backed by the web
// API (snapshots merged server-side, changes polled) and NodeVaultFs, then
// watches the folder so local edits flow up and cloud edits flow to disk,
// conflict-free. The daemon holds one credential, its API key; it has no
// database credential and never did anything the API could not vouch for.
//
// Config is injected rather than read from disk, so the CLI can pass its
// config.json and Electron can pass its own settings. Returns a stop function;
// the caller owns the lifecycle (SIGINT for the CLI, app quit for Electron).

import { watchVault, type VaultWatcher } from "./fs-watcher";
export type { VaultWatcher } from "./fs-watcher";
import { basename, join, relative, sep } from "node:path";
import { deriveTitle, type DocStore, type DocPubSub } from "@markbase/docs";
import type { VaultFs } from "@markbase/protocol/storage";
import { normalizePath, folderOf } from "@markbase/protocol/folders";
import { nextPollDelay } from "@markbase/protocol/poll-backoff";
import { fetchWithTimeout, TRANSFER_TIMEOUT_MS } from "@markbase/protocol/timeout-fetch";
import { IGNORE_FILE, loadVaultIgnore, type VaultIgnore } from "./vault-ignore";
import { ApiCrdtTransport, bearerCrdtRequest } from "@markbase/docs/crdt-api";
import { docsSyncedFiles } from "./docs-synced-file";
import { agentCredit } from "./agent-audit";
import {
  NodeVaultFs,
  NodeVaultBaseStore,
  listMarkdown,
  writeVaultMarker,
  readVaultMarker,
  isMarkdownPath,
} from "./vault-fs";
import { referencedAssets } from "./asset-refs";
import {
  nestedVaultFor,
  markerDirOf,
  ignoredByWatcher,
} from "./vault-boundary";
import { readVaultIndex, writeVaultIndex, type VaultIndexEntry } from "./vault-index";
import { acquireVaultLock } from "./vault-lock";
import { planReconcile } from "@markbase/protocol/vault-reconcile";
import { isSharedVault } from "@markbase/protocol/shared-vault";
import { rawRefsIn, resolveRef } from "@markbase/protocol/asset-refs";
import {
  planAssetSync,
  listDiskAssets,
  writeAsset,
  type CloudAsset,
  mimeForPath,
  readAsset,
  isAssetPath,
  type AssetHashMemo,
} from "./vault-assets";
import { VaultSyncManager, type VaultDocRef, type AdoptFile } from "./vault-sync-manager";
import { resolveWorkerConnection } from "@markbase/protocol/worker-connection";
import {
  VaultGoneError,
  VaultNotOursError,
  recordMountOwner,
  recordedOwnerOf,
  sharedFolderHasDocs,
  vaultOwnerPerApi,
  type VaultOwnerAnswer,
} from "./vault-account";

/**
 * A listing of zero documents for a vault that has synced this many is not
 * believed.
 *
 * Two things produce that shape, and neither is "everything was deleted": a
 * key belonging to a different account (the vault is not that account's, so
 * the list is empty — 2026-10-30, when it made every file in two vaults a new
 * document in another account's name), and a server answering 200 with
 * nothing in it. A person deleting every one of their documents from the web
 * is possible and rare; refusing them costs a line in the log that says how
 * to proceed, where believing the other two costs the vault.
 *
 * Three rather than one, so a vault with a single note that its owner deleted
 * still follows the cloud as it always has.
 */
export const EMPTY_LISTING_GUARD_AT = 3;

function emptyListingMessage(synced: number, dir: string): string {
  return (
    `the cloud lists no documents for this vault, but ${synced} are synced here — ` +
    `that is the wrong account or a server fault, never "everything was deleted"; not syncing. ` +
    `If you really did delete every document, remove ${join(dir, ".markbase", "index.json")} and start again.`
  );
}

/** What a member may do with a shared document, as the API reports it. */
export type DocCapability = "owner" | "editor" | "commenter" | "viewer";

/** Writable, as far as the daemon is concerned. Absent (an owned vault) is. */
const canWrite = (c: DocCapability | undefined): boolean =>
  c === undefined || c === "owner" || c === "editor";

/** Where the first pass has got to. `total` is what this phase must get through. */
export interface VaultSyncProgress {
  /** "opening" = binding documents we already have; "adopting" = uploading new files. */
  phase: "opening" | "adopting";
  done: number;
  total: number;
}

export interface DocSummary {
  id: string;
  title: string;
  /**
   * The document's vault-relative path ("projects/2026/q1.md"). This is what
   * makes folders real end-to-end: without it every doc lands flat at the vault
   * root and cloud→local can never reproduce a folder structure. Absent on
   * documents created before paths existed — those fall back to their title.
   */
  path?: string | null;
  /**
   * The document's markdown, used only to seed a doc the cloud has no CRDT for
   * (see VaultSync.open). Requested with ?content=1, since only the vault needs
   * it — every other caller of the list wants it left out.
   */
  content?: string | null;
  /** Carried into the vault index so a local tree can render without the API. */
  version?: number;
  updated_at?: string;
  // ---- The Shared Vault's list only (GET /docs?scope=shared) ----------------
  /** What the person may do with it. Viewer and commenter files are written read-only. */
  capability?: DocCapability;
  /**
   * Whether anything has opened the document yet. A viewer's daemon cannot seed
   * a CRDT (it may not write), so until one exists it has nothing it can mirror
   * and waits; an editor's seeds it as the owner's would.
   */
  has_crdt?: boolean;
  /** Whose document it is, for the default layout. */
  owner_name?: string;
  /**
   * The owner's path for it, in THEIR vault. Not where it goes here — `path`
   * is — but what its relative image links resolve against on the cloud side.
   */
  owner_path?: string | null;
  vault_id?: string | null;
}

/** A shared document the person edited without the right to: a live fork. */
export interface LocalFork {
  docId: string;
  /** Where it is in the Shared Vault folder. */
  path: string;
  title: string;
  /** When the fork was first noticed. Carried across restarts; never expires. */
  since: string;
}

/** Act on the Shared Vault's forks, from the host that runs the daemon. */
export interface ForkControl {
  list(): LocalFork[];
  /** Both texts, for a comparison. Null when the document is not (or no longer) forked. */
  compare(docId: string): { cloud: string; local: string; path: string; title: string } | null;
  /** Drop the person's edits: the file is the cloud's again. */
  discard(docId: string): boolean;
}

/**
 * What the Shared Vault tells the process that runs it (docs/shared-vault.md).
 *
 * The daemon runs without a window; a fork is the one thing in it a person has
 * to be told about, because the signal before the fact — the file was
 * read-only — has already been overridden. The host notifies, lists, and acts.
 */
export interface SharedVaultHost {
  /**
   * The set of forks changed. `fresh` are the ones that appeared just now for
   * the first time EVER — not after every restart, and not one that was
   * already in the vault index from a previous run. Notify on those.
   */
  onForks(forks: LocalFork[], fresh: LocalFork[]): void;
  /** Called once, when the daemon is ready to be asked. */
  attach?(control: ForkControl): void;
}

export interface VaultSyncOptions {
  /** The vault folder to sync. */
  dir: string;
  /**
   * Which vault this folder holds. A document's path is vault-relative, so
   * without this the daemon would pour every document you can see into one
   * folder. Omit only for the legacy single-vault behaviour.
   */
  vaultId?: string;
  /** Markbase app URL (for the document API). */
  appUrl: string;
  /**
   * What to call this process in the machine-wide sync lock — "desktop", "cli".
   * Only ever shown to a human deciding which one to stop.
   */
  lockOwner?: string;
  /**
   * Seams, for tests. Every one of them defaults to the real thing, so the two
   * hosts pass none of these.
   *
   * The daemon reaches the outside world in exactly four places — the CRDT
   * transport, the document list, creating a document, and the file watcher — and
   * every bug worth having caught lived in how those four are wired together
   * rather than in any of them. Left hard-constructed, none of it could be tested
   * without a real vault, a real account and a real network, which is why the
   * loops were found by watching documents multiply.
   */
  store?: DocStore;
  pubsub?: DocPubSub;
  /** Fetch this vault's documents. `withContent` seeds docs the cloud has no CRDT for. */
  listDocs?: (withContent: boolean) => Promise<DocSummary[]>;
  /** Create a cloud document for a new local file; returns its id, or null. */
  adopt?: AdoptFile;
  /** Build the file watcher. Emits ABSOLUTE paths. */
  watch?: (dir: string) => VaultWatcher;
  /**
   * How far the first pass has got. A vault of any size takes minutes to adopt —
   * one network round trip per document — and until this existed the UI showed
   * the doc list as it was at mount, which for a new vault is "Nothing in this
   * vault yet" for the whole run. Silence and failure looked identical.
   *
   * Called often; the host is expected to throttle what it does with it.
   */
  onProgress?: (p: VaultSyncProgress) => void;
  /**
   * This vault's document SET changed — a file adopted, a document moved or
   * retired. Not content: a keystroke syncing through the CRDT is not this.
   *
   * The host that runs the daemon is often the same process that shows the
   * document list, and it knew the instant a file became a document — yet the
   * list only refreshed when the window happened to regain focus, throttled to
   * once a minute. A folder an agent wrote appeared minutes later, or not until
   * you clicked away and back. Anyone without a renderer (the CLI) omits this.
   *
   * May fire in bursts — adopting a folder is one call per file — so a host that
   * turns it into IPC or a refetch is expected to coalesce.
   */
  onDocsChanged?: () => void;
  /** Markbase API key — identifies whose documents to sync, and is the only
   *  credential this daemon holds. */
  apiKey: string;
  log?: (message: string) => void;
  /**
   * How often to ask the cloud what it now says (ms). A move or a convert made on
   * the web changes a document's path, and nothing pushes that at us. Set 0 to
   * disable (tests, one-shot runs).
   */
  reconcileMs?: number;
  /**
   * How often to record versions for files edited here (ms). Set 0 to disable
   * (tests, one-shot runs).
   */
  checkpointMs?: number;
  /**
   * Who to credit for those versions — the PERSON who owns this vault, not this
   * machine. Omit and the daemon asks the API who its key belongs to; pass null
   * to record history unattributed, or a name to skip the lookup (tests).
   */
  author?: string | null;
  /**
   * The account the key belongs to (a user id). Omit and the daemon asks
   * /api/v1/me; null means "could not be resolved" (tests). A vault whose
   * recorded owner is a different account is refused — see vault-account.ts.
   */
  ownerId?: string | null;
  /** Whose vault this is, per the API. Seam for tests; defaults to GET /vaults/:id. */
  vaultOwner?: (vaultId: string) => Promise<VaultOwnerAnswer>;
  /**
   * A vault found sitting inside ours — dragged in, or created in place. We can't
   * sync it, but we're the one place that *knows* where it went: a folder moved
   * through Finder leaves no trace anywhere else, and here its marker landed in
   * our tree and told us its id. Report it so the caller can offer to repoint the
   * mount, instead of leaving the user to hunt for a vault we already found.
   */
  onForeignVault?: (found: ForeignVault) => void;
  /**
   * The Shared Vault's host (only read when `vaultId` is the shared pseudo
   * vault): told about forks, and handed the means to act on them.
   */
  sharedHost?: SharedVaultHost;
}

/** A vault discovered inside ours: which vault, and where it actually is now. */
export interface ForeignVault {
  vaultId: string;
  /** Absolute path on this machine. */
  dir: string;
  /** Where it sits relative to our vault root. */
  relDir: string;
}

async function listDocs(
  appUrl: string,
  apiKey: string,
  vaultId?: string,
  withContent = false
): Promise<DocSummary[]> {
  // content=1 fetches each doc's markdown, which is ONLY needed to seed a doc the
  // cloud has no CRDT for. So it's opt-in: startup asks for it once (everything is
  // "new" then), but the 15s reconcile lists WITHOUT it — a new doc's content is
  // fetched per-doc, on demand, when it's actually opened (fetchDocContent).
  const params = new URLSearchParams();
  if (withContent) params.set("content", "1");
  // The Shared Vault is not a vault the API knows: its list is the documents
  // shared WITH the caller, whichever vault each one sits in.
  if (isSharedVault(vaultId)) params.set("scope", "shared");
  else if (vaultId) params.set("vault", vaultId);
  const qs = params.toString();
  const url = `${appUrl}/api/v1/docs${qs ? `?${qs}` : ""}`;
  const res = await fetchWithTimeout(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) throw new Error(`couldn't list documents (${res.status})`);
  const body = (await res.json()) as { docs?: DocSummary[] };
  return body.docs ?? [];
}

/** One doc's markdown, to seed it on first open. Returns null on any failure —
 *  the caller treats a missing seed as "the CRDT is the truth". */
async function fetchDocContent(
  appUrl: string,
  apiKey: string,
  id: string
): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(`${appUrl}/api/v1/docs/${id}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { doc?: { content?: string | null } };
    return body.doc?.content ?? null;
  } catch {
    return null;
  }
}

/** The cloud's asset list for a vault, and the tag to revalidate it with. */
interface CloudAssetList {
  assets: Array<CloudAsset & { url: string | null }>;
  etag: string | null;
}

/**
 * The vault's assets as the cloud knows them.
 *
 * `urls: false` asks the server not to sign a download URL per asset. Signing
 * every asset on every 15-second pass was most of what the server did on
 * 2026-09-13 — the same 40 images, ~450 times an hour each — for URLs the daemon
 * only needs for the (usually zero) files it is about to download.
 *
 * `etag` is the tag from the last answer. When nothing changed the server says
 * 304 and this returns null: "same as last time". A server that predates either
 * knob ignores it and answers in full, so this degrades to the old behaviour.
 */
async function listCloudAssets(
  appUrl: string,
  apiKey: string,
  vaultId: string,
  opts: { urls: boolean; etag?: string }
): Promise<CloudAssetList | null> {
  const params = new URLSearchParams({ vault: vaultId });
  if (!opts.urls) params.set("urls", "0");
  const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}` };
  if (opts.etag) headers["If-None-Match"] = opts.etag;
  const res = await fetchWithTimeout(`${appUrl}/api/v1/assets?${params}`, { headers });
  if (res.status === 304) return null;
  if (!res.ok) throw new Error(`couldn't list assets (${res.status})`);
  const body = (await res.json()) as {
    assets?: Array<{ path: string; sha256: string; url: string | null }>;
  };
  return { assets: body.assets ?? [], etag: res.headers.get("etag") };
}


async function uploadAsset(
  appUrl: string,
  apiKey: string,
  vaultId: string,
  path: string,
  bytes: Uint8Array
): Promise<boolean> {
  const form = new FormData();
  // The basename is only a fallback name; `path` is what the markdown references,
  // so it must win — an image the user filed at notes/img/a.png stays there.
  // A disk stores no content type; the extension is all we have. Without it the
  // image uploads as octet-stream and the browser downloads it instead of
  // showing it.
  //
  // Copied into a plain ArrayBuffer because this file is typechecked twice: once
  // by core against node's libs, and again by the web app against the DOM's, where
  // BlobPart won't accept a Uint8Array<ArrayBufferLike>. An ArrayBuffer satisfies
  // both — and honestly beats casting the type away.
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  form.set("file", new Blob([buf], { type: mimeForPath(path) }), basename(path));
  form.set("vault_id", vaultId);
  form.set("path", path);
  const res = await fetchWithTimeout(`${appUrl}/api/v1/assets`, {
    timeoutMs: TRANSFER_TIMEOUT_MS,
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  return res.ok;
}

/** Turn a new local file into a cloud document via the API. The path is stored
 *  so the file stays in its folder on the next sync. The title is what the file
 *  declares (frontmatter, or an opening h1), falling back to the filename — a
 *  blog post adopted from disk should show as "Prometheus Behind NAT", not as
 *  "prometheus-behind-nat-reverse-tunnel". The path is unaffected either way:
 *  only an explicit rename moves a file. */
function makeAdopt(
  appUrl: string,
  apiKey: string,
  log: (m: string) => void,
  vaultId?: string
): AdoptFile {
  return async (path, content) => {
    const title =
      deriveTitle(content) || basename(path).replace(/\.md$/i, "") || "untitled";
    const res = await fetchWithTimeout(`${appUrl}/api/v1/docs`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      // The new doc joins the vault this folder holds, not the default one.
      // `adopt`: this came from a folder, so it may be a document that left and
      // came back rather than a new one. The server decides — it is the only
      // side that can see what is in the trash.
      body: JSON.stringify({ title, content, path, vault_id: vaultId, adopt: true }),
    });
    if (!res.ok) {
      log(`couldn't adopt ${path} (${res.status})`);
      return null;
    }
    const body = (await res.json()) as {
      doc?: { id?: string };
      revived?: "content" | "path";
    };
    const id = body.doc?.id ?? null;
    if (id) {
      log(
        body.revived
          ? `adopted ${path} → restored the document it was before ` +
              `(matched by ${body.revived}) — its comments and links came back`
          : `adopted ${path} → new document`
      );
    }
    return id;
  };
}

/**
 * Write a document's new location back to the cloud. A move re-keyed only in
 * memory would be undone by the next sync — assignPaths would resolve the stale
 * stored path and pull the file back to where it was.
 */
/**
 * Delete the document a deleted file stood for.
 *
 * Soft on the server — the row keeps its content and gains a `deleted_at` — so
 * this is undoable, which is the only reason it is safe to let a file manager
 * drive it.
 *
 * In the Shared Vault the document is not ours to delete, and the server would
 * refuse (owner only). Deleting the file there means LEAVING the share: the
 * member's own row goes, and the owner's document is untouched.
 */
function makeDeleteDoc(
  appUrl: string,
  apiKey: string,
  shared: boolean
): (docId: string) => Promise<boolean> {
  const suffix = shared ? "/membership" : "";
  return async (docId) => {
    const res = await fetchWithTimeout(`${appUrl}/api/v1/docs/${docId}${suffix}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    return res.ok;
  };
}

/** How many times a rename retries before the cloud's path is allowed to win. */
const PATH_PERSIST_TRIES = 20;

/**
 * Save a rename the user made on disk, and keep trying until it lands.
 *
 * It used to be one fire-and-forget PATCH that logged its own failure — and
 * reconcile, fifteen seconds later, would move the file back to the path the
 * cloud still knew. Rename a file during a network blip and it renamed itself
 * back, which is the same shape as a deleted file coming back: a local action
 * undone in silence because the cloud had not heard about it.
 *
 * So a failure is remembered rather than logged and dropped. While it is
 * outstanding the reconcile pass leaves that document alone (see `pending`), and
 * each pass retries it. Bounded, because a rename that can never be saved — the
 * document was deleted on another device, say — must not hold the two views
 * apart forever; after that the cloud wins and says so.
 */
class PathWriter {
  /** docId → the local path the cloud has not accepted yet. */
  private readonly unsaved = new Map<string, { path: string; tries: number }>();

  constructor(
    private readonly appUrl: string,
    private readonly apiKey: string,
    private readonly log: (m: string) => void,
    /**
     * The Shared Vault: a move there is the MEMBER's filing, saved on their
     * membership row, never on the owner's document (whose path it would
     * otherwise move, in the owner's own folder).
     */
    private readonly shared = false
  ) {}

  persist = (docId: string, newPath: string): void => {
    this.unsaved.set(docId, { path: newPath, tries: 0 });
    void this.flushOne(docId);
  };

  /** Whether this document has a local path the cloud has not accepted. */
  pending(docId: string): boolean {
    return this.unsaved.has(docId);
  }

  /** Called each reconcile: another go at whatever has not landed. */
  async retry(): Promise<void> {
    for (const docId of [...this.unsaved.keys()]) await this.flushOne(docId);
  }

  private async flushOne(docId: string): Promise<void> {
    const held = this.unsaved.get(docId);
    if (!held) return;
    let ok = false;
    try {
      const target = this.shared ? `/api/v1/docs/${docId}/membership` : `/api/v1/docs/${docId}`;
      const res = await fetchWithTimeout(`${this.appUrl}${target}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ path: held.path }),
      });
      ok = res.ok;
    } catch {
      ok = false;
    }
    if (ok) {
      this.unsaved.delete(docId);
      return;
    }
    held.tries += 1;
    if (held.tries >= PATH_PERSIST_TRIES) {
      this.unsaved.delete(docId);
      this.log(
        `couldn't save the new path for ${held.path} after ${held.tries} tries — ` +
          `the cloud's path wins now, so the file may move back`
      );
    }
  }
}

/** Filesystem-safe single path segment (the separators are already split off). */
function sanitizeSegment(s: string): string {
  return s.replace(/[/\\:*?"<>|]+/g, "-").trim() || "untitled";
}

/** A stored path → normalized, sanitized, guaranteed to end in .md. */
function normalizeDocPath(p: string): string {
  const segs = normalizePath(p).split("/").filter(Boolean).map(sanitizeSegment);
  if (segs.length === 0) return "untitled.md";
  const last = segs[segs.length - 1];
  segs[segs.length - 1] = /\.md$/i.test(last) ? last : `${last}.md`;
  return segs.join("/");
}

/**
 * Where each document lives in the vault. A document's stored path wins (that's
 * what carries folders down from the cloud); one without a path yet falls back to
 * a sanitized title at the root. Collisions get an id suffix on the *filename*,
 * so the folder is preserved.
 */
/**
 * The vault index for this doc set: the mapping the daemon just computed, in the
 * form a reader needs. `path` is the document's own path (what a tree groups
 * by); `file` is where it actually landed here, which differs when two documents
 * wanted one filename.
 */
export function indexEntries(
  docs: DocSummary[],
  refs: VaultDocRef[],
  inodeOf: (file: string) => number | null = () => null,
  /** The Shared Vault: which documents carry local-only edits, and since when. */
  forkOf: (docId: string) => { since: string } | undefined = () => undefined
): VaultIndexEntry[] {
  const fileById = new Map(refs.map((r) => [r.id, r.path]));
  return docs
    .filter((d) => fileById.has(d.id))
    .map((d) => {
      const file = fileById.get(d.id) as string;
      const entry: VaultIndexEntry = {
        id: d.id,
        title: d.title,
        path: d.path ?? null,
        file,
        version: d.version ?? 0,
        updated_at: d.updated_at ?? "",
      };
      const ino = inodeOf(file);
      if (ino !== null) entry.ino = ino;
      if (d.capability && d.capability !== "owner") entry.capability = d.capability;
      const fork = forkOf(d.id);
      if (fork) entry.fork = fork;
      return entry;
    });
}

/**
 * Renames made while nothing was watching.
 *
 * The watcher pairs an unlink with the add that follows it; a rename made with
 * the daemon stopped has no events to pair. What it does have is the inode: the
 * last index wrote one down for every file, and a rename keeps it. So a
 * document whose file is gone, while an untracked file carries its inode, was
 * renamed — not deleted and replaced by a stranger. Without this the next start
 * wrote the old file back from the cloud and adopted the new one as a second
 * document: the "sync doesn't recognise the file any more" that kept filename
 * changes off-limits.
 *
 * Only documents the cloud still lists are candidates, and each file on disk is
 * claimed at most once.
 */
export function recoverRenames(
  index: VaultIndexEntry[],
  docs: DocSummary[],
  onDisk: string[],
  inodeOf: (file: string) => number | null
): Array<{ id: string; from: string; to: string }> {
  const live = new Set(docs.map((d) => d.id));
  const tracked = new Set(index.map((e) => e.file));
  const present = new Set(onDisk);
  const strangers = new Map<number, string>();
  for (const file of onDisk) {
    if (tracked.has(file)) continue;
    const ino = inodeOf(file);
    if (ino !== null && !strangers.has(ino)) strangers.set(ino, file);
  }
  const moves: Array<{ id: string; from: string; to: string }> = [];
  for (const e of index) {
    if (e.ino === undefined || !live.has(e.id) || present.has(e.file)) continue;
    const to = strangers.get(e.ino);
    if (to === undefined) continue;
    strangers.delete(e.ino);
    moves.push({ id: e.id, from: e.file, to });
  }
  return moves;
}

/**
 * Does this filename look like one assignPaths generated for a collision?
 *
 * When two documents want one filename the loser gets "<name> <8 hex>.md". That
 * shape is produced HERE and nowhere else, so a file wearing it is one this
 * daemon materialized — never new material a person created. Adopting it makes a
 * document whose path is the suffixed name, which collides afresh and produces
 * another suffixed file: an amplifying loop that turned 23 documents into 46.
 */
export function looksGenerated(path: string): boolean {
  return / [0-9a-f]{8}\.md$/i.test(path);
}

export function assignPaths(docs: DocSummary[]): VaultDocRef[] {
  // Collisions are decided in a STABLE order — by document id, which never
  // changes — not in the order the list arrived.
  //
  // The API returns documents newest-updated first. Deciding by arrival order
  // meant the winner of a contested filename flipped every time either document
  // was touched — and being moved IS a touch: the daemon renames the file, pushes,
  // the row's updated_at changes, the order swaps, and the next reconcile renames
  // it back. Two documents wanting one filename ping-ponged every 15 seconds,
  // forever, each round a file move and a push.
  //
  // Sorting by id makes the same document win every time, so a collision
  // resolves once and stays resolved. (The duplicates themselves are a separate
  // problem — see the adoption guards — but the daemon must not thrash even when
  // they exist.)
  const byId = [...docs].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const seen = new Map<string, number>();
  const assigned = new Map<string, string>();
  for (const d of byId) {
    const desired = d.path ? normalizeDocPath(d.path) : `${sanitizeSegment(d.title)}.md`;
    const n = seen.get(desired) ?? 0;
    seen.set(desired, n + 1);
    if (n === 0) {
      assigned.set(d.id, desired);
      continue;
    }
    const dir = folderOf(desired);
    const file = dir ? desired.slice(dir.length + 1) : desired;
    const name = `${file.replace(/\.md$/i, "")} ${d.id.slice(0, 8)}.md`;
    assigned.set(d.id, dir ? `${dir}/${name}` : name);
  }
  // Returned in the caller's order; only the DECISION is order-independent.
  return docs.map((d) => {
    const ref: VaultDocRef = { id: d.id, path: assigned.get(d.id) as string, seed: d.content ?? undefined };
    // A shared document the person may only read: its file is written
    // read-only and its replica never saved (docs/shared-vault.md).
    if (!canWrite(d.capability)) ref.readOnly = true;
    return ref;
  });
}

/**
 * Which of the Shared Vault's documents this daemon can mirror right now.
 *
 * A viewer's replica may not save, so it cannot be the one that gives a
 * document its first CRDT: seeding one locally and never sending it would leave
 * a replica whose history the cloud never shares, and the first real snapshot
 * to arrive would merge as duplicated text. Until the owner (or an editor) has
 * opened the document once there is nothing it can safely hold, so it waits.
 * An owned vault's list carries no `has_crdt` and is mirrored whole.
 */
export function mirrorable(d: DocSummary): boolean {
  return d.has_crdt !== false || canWrite(d.capability);
}

/**
 * Start syncing a vault folder. Resolves once the initial reconcile is done and
 * the watcher is live; call the returned function to stop.
 */
export async function startVaultSync(opts: VaultSyncOptions): Promise<() => Promise<void>> {
  const log = opts.log ?? ((m: string) => console.log(`[vault-sync] ${m}`));
  const { dir, appUrl, apiKey } = opts;
  // The Shared Vault (docs/shared-vault.md): the documents other people shared
  // with this user, in one folder of theirs. The same loop as an owned vault,
  // with the rules that follow from "none of these documents is yours":
  //   • a new file in the folder is not adopted — there is no owner to make it for
  //   • a deleted file leaves the share, never deletes the document
  //   • a document gone from the list was un-shared — its file is retired
  //   • a viewer's or commenter's file is read-only, and an edit made to it
  //     anyway is kept as a live fork, never sent up
  const shared = isSharedVault(opts.vaultId);

  // One syncing process per vault per machine. The desktop app and the CLI drive
  // this same engine, and both claiming a folder makes them fight over filenames
  // — see vault-lock.ts. Throws VaultLockedError when someone else has it; the
  // caller decides how loudly to say so.
  //
  // Losing it mid-run stops us. `stop` is defined much further down (it needs the
  // watcher and the manager), so the callback reaches it through this box rather
  // than by hoisting the whole daemon.
  const stopBox: { stop?: () => Promise<void> } = {};
  const lock = opts.vaultId
    ? acquireVaultLock(opts.vaultId, opts.lockOwner ?? "markbase", (holder) => {
        log(
          `the ${holder.owner} (pid ${holder.pid}) has taken over this vault — stopping, so we don't both sync it`
        );
        void stopBox.stop?.();
      })
    : null;

  const myVaultId = opts.vaultId ?? null;
  /** Give the lock back before refusing: a refusal is not a run. */
  const refuse = (e: Error): never => {
    lock?.release();
    throw e;
  };

  // ---- Whose vault is this, and is it this key's? (vault-account.ts) ---------
  // Decided before anything is written — the marker, the index, a document.
  // The host has normally settled this already and never starts a daemon for
  // another account's mount; this is the check at the point of writing, so a
  // host that did not (an older CLI, a legacy mount) still cannot sync a vault
  // under the wrong key. The key's owner and the author's name come from the
  // same /me answer, so they are resolved together.
  const connection =
    opts.ownerId !== undefined && opts.author !== undefined
      ? null
      : await resolveWorkerConnection(appUrl, apiKey);
  let keyOwner: string | null =
    opts.ownerId !== undefined ? opts.ownerId : (connection?.ownerId ?? null);
  const author = opts.author !== undefined ? opts.author : (connection?.ownerName ?? null);
  const vaultOwner = opts.vaultOwner ?? ((id: string) => vaultOwnerPerApi(appUrl, apiKey, id));
  type Settled = { owner: string } | "not-ours" | "deleted" | "unknown" | "unbound-shared";
  /**
   * The account this folder belongs to, settled against the key's:
   *   recorded (marker or registry) and equal to the key's  → ours
   *   recorded and different                                 → not ours
   *   recorded, key's owner unknown                          → unknown
   *   nothing recorded: an owned vault is asked about — the owner gets the
   *   row, anyone else a 403 ("not ours"), a vault that no longer exists a 404
   *   ("deleted"). The Shared Vault is not a row: a folder that has never
   *   synced is whoever mounts it; one that holds documents is settled by the
   *   listing (bindSharedByListing) — the account they were shared with is the
   *   one whose shared list names them.
   */
  const settleOwner = async (): Promise<Settled> => {
    if (!myVaultId) return "unknown"; // legacy single-folder mode: no vault to bind
    // /me did not answer at start: ask again, each time, until it does.
    if (keyOwner === null && opts.ownerId === undefined) {
      keyOwner = (await resolveWorkerConnection(appUrl, apiKey))?.ownerId ?? null;
    }
    const recorded = recordedOwnerOf({ vaultId: myVaultId, dir });
    if (recorded) {
      if (keyOwner === null) return "unknown";
      return recorded === keyOwner ? { owner: recorded } : "not-ours";
    }
    if (shared) {
      if (keyOwner === null) return "unknown";
      return sharedFolderHasDocs(dir) ? "unbound-shared" : { owner: keyOwner };
    }
    const whose = await vaultOwner(myVaultId);
    if (whose === "not-ours") return "not-ours";
    if (whose === "deleted") return "deleted";
    if (whose === null) return "unknown";
    if (keyOwner !== null && whose.ownerId !== keyOwner) return "not-ours";
    return { owner: whose.ownerId };
  };
  // Settled "unknown" at start: nothing the cloud says is acted on — no
  // adoption, no retiring — until a later pass settles it. Offline, that is
  // every pass until the network is back, which is also when the cloud could
  // first be acted on anyway.
  let ownerPending = false;
  /** The Shared Vault, mounted here before owners were recorded, with documents in it. */
  let sharedUnbound = false;
  /**
   * Whose Shared Vault folder is this? The account the documents in it were
   * shared with — so if this key's shared listing names any document the
   * folder's index holds, it is this key's. If it names none, the folder was
   * mounted by another account (or every share was revoked, which looks the
   * same and is left alone for the same reason: nothing here is this key's).
   */
  const bindSharedByListing = (listed: DocSummary[]): "ours" | "not-ours" => {
    const ids = new Set(listed.map((d) => d.id));
    const held = readVaultIndex(dir)?.docs ?? [];
    return held.some((d) => ids.has(d.id)) ? "ours" : "not-ours";
  };
  const sharedNotOurs = (): Error =>
    new Error(
      "the Shared Vault folder here holds documents that are not shared with this account — " +
        "it was mounted by another account (or every share was revoked); not syncing"
    );
  if (myVaultId) {
    const settled = await settleOwner();
    if (settled === "unbound-shared") {
      sharedUnbound = true;
    } else if (settled === "not-ours") {
      refuse(new VaultNotOursError(myVaultId, recordedOwnerOf({ vaultId: myVaultId, dir }), keyOwner));
    } else if (settled === "deleted") {
      // Nothing to sync it with, and nothing here to retire it by: the host's
      // deletion check owns that, with its own dialog and .trash move.
      refuse(new VaultGoneError(myVaultId));
    } else if (settled === "unknown") {
      ownerPending = true;
      log("couldn't confirm which account this vault belongs to yet — not adopting or retiring anything until it is");
    } else {
      await recordMountOwner(myVaultId, dir, settled.owner);
    }
  }

  // Mark this folder as our vault root. The marker travels with the folder, so a
  // vault dragged into another can still be recognised as not-ours by the outer
  // daemon. Without a vault id we're the legacy single-vault case: no nesting to
  // police, so no marker.
  if (myVaultId) writeVaultMarker(dir, myVaultId);

  /**
   * Which vault nested inside ours owns this path, if any? Reads markers straight
   * off disk every time — cheap, and it must react the moment a user creates or
   * deletes a nested vault while we're running.
   */
  const foreignVault = (path: string): string | null => {
    if (!myVaultId) return null;
    return nestedVaultFor(path, (relDir) => readVaultMarker(join(dir, relDir)), myVaultId);
  };
  const reported = new Set<string>();
  /** Say (once) that a subtree isn't ours — to the log, and to the caller. */
  const noteForeign = (relDir: string): void => {
    if (reported.has(relDir)) return;
    reported.add(relDir);
    const vaultId = readVaultMarker(join(dir, relDir));
    log(`ignoring ${relDir}/ — it's another vault, not part of this one`);
    if (vaultId) opts.onForeignVault?.({ vaultId, dir: join(dir, relDir), relDir });
  };

  // Startup seeds everything, so fetch content in one batch. The recurring
  // reconcile below lists without it (fetchDocContent covers new docs on demand).
  const fetchRaw = opts.listDocs ?? ((c: boolean) => listDocs(appUrl, apiKey, opts.vaultId, c));
  /** Documents the shared list carries but this daemon cannot mirror yet (see mirrorable). */
  const waitingFor = new Set<string>();
  const fetchDocs = async (c: boolean): Promise<DocSummary[]> => {
    const all = await fetchRaw(c);
    if (!shared) return all;
    const ready: DocSummary[] = [];
    for (const d of all) {
      if (mirrorable(d)) {
        if (waitingFor.delete(d.id)) log(`"${d.title}" has been opened by its owner — mirroring it now`);
        ready.push(d);
      } else if (!waitingFor.has(d.id)) {
        waitingFor.add(d.id);
        log(`"${d.title}" is shared read-only and nobody has opened it yet — waiting for its owner to`);
      }
    }
    return ready;
  };
  // The folder is the vault; the cloud is where it syncs to. So an unreachable
  // cloud is not a reason to stop watching the folder. This used to throw, the
  // desktop app put up "Couldn't sync", and nothing watched the files until a
  // relaunch. Start from the index the last successful sync wrote instead: it says
  // which files are already documents, so none of them is mistaken for a new one.
  // Only a vault that has NEVER synced here has no index — and without one there is
  // no telling a new file from an existing document, so that case still needs the
  // cloud.
  let startedOffline = false;
  let docs: DocSummary[];
  try {
    docs = await fetchDocs(true);
  } catch (e) {
    const known = opts.vaultId ? readVaultIndex(dir) : null;
    if (!known || known.vaultId !== opts.vaultId) {
      refuse(e instanceof Error ? e : new Error(String(e)));
      throw e; // unreachable: refuse never returns, but the narrowing below needs the branch to end
    }
    startedOffline = true;
    docs = known.docs.map((d) => ({ id: d.id, title: d.title, path: d.path, capability: d.capability }));
    log(
      `cloud unreachable (${e instanceof Error ? e.message : String(e)}) — starting from ` +
        `the last known index (${docs.length} document(s)); will catch up when it's back`
    );
  }
  // The Shared Vault with documents and no recorded account: the listing just
  // fetched says whose they are. Settled before anything is opened, because
  // opening materialises this key's documents into the folder.
  if (!startedOffline && sharedUnbound) {
    if (keyOwner === null) refuse(new Error("couldn't confirm which account the Shared Vault belongs to — not syncing until it can"));
    if (bindSharedByListing(docs) === "not-ours") refuse(sharedNotOurs());
    sharedUnbound = false;
    await recordMountOwner(myVaultId as string, dir, keyOwner as string);
  }
  // An empty list for a vault that has synced documents here is not believed —
  // see EMPTY_LISTING_GUARD_AT. Checked against the index the last run wrote,
  // because the listing is what the rest of this start acts on: every file it
  // does not mention would be adopted as new, which is exactly what happened.
  if (!startedOffline && myVaultId && !shared && docs.length === 0) {
    const known = readVaultIndex(dir);
    if (known && known.vaultId === myVaultId && known.docs.length >= EMPTY_LISTING_GUARD_AT) {
      refuse(new Error(emptyListingMessage(known.docs.length, dir)));
    }
  }
  // Every file this daemon writes, and when.
  //
  // A file we materialized is never new material — it is a document we already
  // have, arriving from the cloud. The watcher cannot tell the difference: it
  // just sees a file appear. The manager's `opening` guard covers the moment a
  // document is first opened, but not a write that lands any other way (a move
  // the reconcile planned, a flush to a renamed path), and any of those could be
  // adopted as a brand-new document — which then collides with the original over
  // its filename and starts the churn.
  //
  // Recording writes here catches all of them at once, because every write in
  // this daemon goes through this one object.
  const written = new Map<string, number>();
  // What this vault does not sync, read from its own .markbaseignore (seeded with
  // the defaults if it has none). Read ONCE per run: the rules describe the shape
  // of the folder, and re-reading them per file would put a stat in every walk.
  let ignore = loadVaultIgnore(dir);
  const disk = new NodeVaultFs(dir);
  // The inode of every tracked file, by path. An unlink can't stat what is gone,
  // so a rename's add is matched against what we knew BEFORE — which makes the
  // pairing exact even when the user edited the file on the way (content
  // matching, the fallback, can't see through that). Entries go stale when a
  // file is retired; a lookup checks the path is still ours and really gone.
  const inodes = new Map<string, number>();
  const noteInode = (path: string): void => {
    const ino = disk.inode(path);
    if (ino === null) inodes.delete(path);
    else inodes.set(path, ino);
  };
  // The paths whose documents the person may only read — written 0444, so an
  // editor asks before overwriting and an agent's write tool reports a
  // permission error (docs/shared-vault.md). Refreshed from every list; a
  // local rename re-keys it. Empty in an owned vault.
  const readOnlyPaths = new Set<string>();
  const fs: VaultFs = {
    read: (path: string) => disk.read(path),
    write: (path: string, content: string) => {
      written.set(path, Date.now());
      disk.write(path, content);
      if (readOnlyPaths.has(path)) disk.setReadOnly(path, true);
      noteInode(path);
    },
    trash: (path: string) => {
      disk.trash(path);
      inodes.delete(path);
    },
    inode: (path: string) => disk.inode(path),
    rename: (from: string, to: string) => {
      disk.rename(from, to);
      written.set(to, Date.now());
      inodes.delete(from);
      if (readOnlyPaths.delete(from)) readOnlyPaths.add(to);
      noteInode(to);
    },
  };
  /**
   * Make the mode bits say what the list says: every read-only document's file
   * loses its write bits, and a file whose document became writable (the
   * person was made an editor) gets them back. Only files this daemon tracks
   * are touched, and only when the bits disagree.
   */
  const applyReadOnly = (refs: VaultDocRef[]): void => {
    const next = new Set(refs.filter((r) => r.readOnly).map((r) => r.path));
    for (const p of readOnlyPaths) if (!next.has(p)) disk.setReadOnly(p, false);
    readOnlyPaths.clear();
    for (const p of next) {
      readOnlyPaths.add(p);
      disk.setReadOnly(p, true);
    }
  };
  const inodeOf = (path: string): number | null => disk.inode(path);
  const paths = new PathWriter(appUrl, apiKey, log, shared);
  // Before any file is resolved: a document renamed on disk while the daemon
  // was stopped must open at its NEW name, or the old one is written back from
  // the cloud and the new one adopted as a second document.
  if (opts.vaultId && !startedOffline) {
    const known = readVaultIndex(dir);
    if (known && known.vaultId === opts.vaultId) {
      for (const mv of recoverRenames(known.docs, docs, listMarkdown(dir, ignore), inodeOf)) {
        const doc = docs.find((d) => d.id === mv.id);
        if (doc) doc.path = mv.to;
        paths.persist(mv.id, mv.to);
        log(`${mv.from} was renamed to ${mv.to} while nothing was watching — same document`);
      }
    }
  }
  /** How long after writing a file we still recognise it as ours. */
  const SELF_WRITE_MS = 30_000;
  // Resolve every document's file BEFORE opening it. A doc whose path lands inside
  // a nested vault must never be opened at all: opening materializes it, writing
  // our content into a folder another daemon owns.
  const refs: VaultDocRef[] = [];
  for (const ref of assignPaths(docs)) {
    const foreign = foreignVault(ref.path);
    if (foreign) {
      noteForeign(foreign);
      continue;
    }
    refs.push(ref);
  }
  // `author` — who to credit for the files edited on this machine — was
  // resolved above, with the key's owner: the daemon holds a bearer token and
  // nothing else, so it asked the API who that token belongs to. The answer is
  // a PERSON: you typed it in Obsidian, and this process is transport. Null on
  // any failure, which keeps history unattributed rather than not keeping it.
  // The cloud transport and the merge base belong to the CONTENT, not the
  // container, so they are hoisted out of the manager call and closed over by the
  // file opener below. The manager never sees them.
  //
  // The retry log matters: a link that needs three attempts per snapshot is
  // degrading, and without this it degrades silently until something breaks.
  //
  // One transport for both halves: the store learns a version on every save,
  // and the poll behind the pub/sub skips what the store already holds.
  const transport = new ApiCrdtTransport(
    bearerCrdtRequest(appUrl, () => apiKey, (url, init) =>
      fetchWithTimeout(url, init)
    ),
    {
      // The Shared Vault polls the feed of documents shared with the user; an
      // owned vault polls its own. One or the other, never both.
      ...(shared ? { scope: "shared" as const } : { vaultId: opts.vaultId }),
      onRetry: (attempt, message) =>
        log(`retrying the cloud snapshot (attempt ${attempt}): ${message}`),
      log: (m) => log(`change feed: ${m}`),
    }
  );
  const store = opts.store ?? transport.store;
  const pubsub = opts.pubsub ?? transport.pubsub;
  // Keyed by the vault, not the folder: repointing a vault to a new folder
  // must keep its merge base, or A4's offline protection silently lapses.
  const baseStore = new NodeVaultBaseStore(opts.vaultId ?? dir);
  const manager = await VaultSyncManager.open(
    // Opening a document reads its snapshot from the cloud. Offline every one of
    // those would wait out its timeout in turn — minutes to hours for a large
    // vault — so open nothing yet. The paths are claimed below, and the first
    // reconcile that reaches the cloud opens them, three-way merging any edit made
    // to the files in the meantime.
    startedOffline ? [] : refs,
    fs,
    // This is the injection: the composition root decides that a file in this
    // vault is a CRDT markdown document. Swap this one argument and the same
    // container syncs something else.
    docsSyncedFiles(store, pubsub, fs, baseStore, log),
    {
      // No adoption in the Shared Vault: a file dropped there has no owner to
      // create a document for. tryAdopt says so; the manager just has nothing
      // to call.
      adopt: shared ? undefined : (opts.adopt ?? makeAdopt(appUrl, apiKey, log, opts.vaultId)),
      onMoved: paths.persist,
      onOpened: (done, total) => opts.onProgress?.({ phase: "opening", done, total }),
      author,
      // Which agent wrote a change, when its hook reported the write
      // (`markbase write-audit`): a version then says so.
      agentCredit: (path) => agentCredit(dir, path),
    }
  );
  if (startedOffline) manager.setClaims(refs);
  for (const r of manager.refs()) noteInode(r.path);
  applyReadOnly(refs);

  // ---- Forks: the Shared Vault's read-only files that were edited anyway -----
  // The list as last fetched and the paths as last assigned, so the index can
  // be rewritten whenever the fork set moves, not only on a reconcile.
  let lastDocs = docs;
  let lastRefs = refs;
  const forks = new Map<string, LocalFork>();
  // Forks the previous run had already noticed, with when. A fork that is still
  // there after a restart is not news; one that the person resolved while the
  // daemon was down is simply gone. Read once, consulted once.
  let carried: Map<string, string> | null = new Map(
    (opts.vaultId ? (readVaultIndex(dir)?.docs ?? []) : [])
      .filter((e) => e.fork)
      .map((e) => [e.id, (e.fork as { since: string }).since])
  );
  const writeIndex = (): void => {
    if (!opts.vaultId) return;
    writeVaultIndex(
      dir,
      opts.vaultId,
      indexEntries(lastDocs, lastRefs, inodeOf, (id) => {
        const f = forks.get(id);
        return f ? { since: f.since } : undefined;
      })
    );
  };
  /**
   * Re-read which files are forked and tell the host what changed. Cheap — a
   * markdown comparison per read-only document — so it runs after every event
   * that could change the answer: a file edit, a cloud update landing, a
   * discard, a reconcile.
   */
  const updateForks = (): void => {
    if (!shared) return;
    const now = manager.localForks();
    const next = new Map<string, LocalFork>();
    const fresh: LocalFork[] = [];
    for (const f of now) {
      const prev = forks.get(f.docId);
      const known = prev?.since ?? carried?.get(f.docId);
      const title = lastDocs.find((d) => d.id === f.docId)?.title ?? basename(f.path, ".md");
      const entry: LocalFork = { docId: f.docId, path: f.path, title, since: known ?? new Date().toISOString() };
      next.set(f.docId, entry);
      if (!known) fresh.push(entry);
    }
    carried = null; // only the first pass may inherit a `since`
    const changed =
      next.size !== forks.size ||
      [...next.values()].some((f) => {
        const prev = forks.get(f.docId);
        return !prev || prev.path !== f.path;
      });
    if (!changed) return;
    forks.clear();
    for (const [id, f] of next) forks.set(id, f);
    writeIndex();
    for (const f of fresh) log(`"${f.title}" is shared read-only, and ${f.path} was edited — keeping your edits here as a local fork`);
    opts.sharedHost?.onForks([...forks.values()], fresh);
  };
  // Written AFTER the files exist, so each entry carries its inode. Offline,
  // `docs` IS the index — rewriting it would only lose what it knew.
  if (opts.vaultId && !startedOffline) writeIndex();
  updateForks();
  if (shared) {
    opts.sharedHost?.attach?.({
      list: () => [...forks.values()],
      compare: (docId) => {
        const both = manager.forkContents(docId);
        if (!both) return null;
        return { ...both, title: forks.get(docId)?.title ?? basename(both.path, ".md") };
      },
      discard: (docId) => {
        const dropped = manager.discardFork(docId);
        if (dropped) {
          log(`discarded the local edits to ${forks.get(docId)?.path ?? docId}`);
          updateForks();
        }
        return dropped;
      },
    });
  }
  const deleteDoc = makeDeleteDoc(appUrl, apiKey, shared);
  log(
    startedOffline
      ? `watching ${dir} — ${refs.length} document(s) will sync when the cloud is reachable`
      : `syncing ${refs.length} ${shared ? "shared " : ""}document(s) in ${dir}`
  );

  /**
   * Turn a file into a new document — unless it is a copy of one we already have.
   *
   * The ONLY way a file becomes a document. There were three separate call sites
   * and the guards lived at one of them, so a file that survived a restart was
   * adopted by the startup sweep that the watcher path would have refused.
   *
   * Two refusals, both meaning "this is already ours":
   *   • a name of the shape assignPaths generates for a collision — produced
   *     nowhere else, so the file is one this daemon wrote
   *   • content identical to a document we sync, whatever the file is called.
   *     findMovedFrom cannot see these: it only recognises a move once the
   *     ORIGINAL path is gone, and here both files exist.
   */
  const tryAdopt = async (path: string): Promise<void> => {
    if (shared) {
      // There is nobody to make a document for: the Shared Vault holds other
      // people's documents, and a file that is not one of them stays a file.
      log(`not adopting ${path} — the Shared Vault only holds documents shared with you`);
      return;
    }
    const wroteAt = written.get(path);
    if (wroteAt !== undefined && Date.now() - wroteAt < SELF_WRITE_MS) {
      // We put this file here. Creating a document for it would be inventing a
      // second document for content the cloud already has.
      log(`not adopting ${path} — this daemon just wrote it`);
      return;
    }
    if (looksGenerated(path)) {
      log(`not adopting ${path} — this daemon generated that name`);
      return;
    }
    // The vault's own rules, checked HERE and not only in the watcher's filter.
    // The watcher drops events for ignored paths, but the startup sweep and
    // folder-un-nesting reach this function by other routes entirely. This is
    // the decision point for "should it become a document", so it is where the
    // answer belongs.
    if (ignore.ignores(path)) {
      log(`not adopting ${path} — .markbaseignore covers it`);
      return;
    }
    // The cloud already has a document at this path. That is true whether or not
    // we hold it open — and the guards below can't see it if we don't, because
    // findByContent only walks documents we opened. Without this, one failed
    // snapshot fetch is enough to adopt an existing document a second time.
    const owner = manager.claimedBy(path);
    if (owner !== null) {
      log(`not adopting ${path} — the cloud already has a document here (${owner.slice(0, 8)})`);
      return;
    }
    const content = fs.read(path);
    if (content !== null) {
      const twin = manager.findByContent(content);
      if (twin !== null) {
        log(`not adopting ${path} — same content as ${twin}`);
        return;
      }
    }
    const id = await manager.adoptFile(path);
    if (id) {
      log(`adopted ${path}`);
      opts.onDocsChanged?.();
    }
  };

  // Adopt any pre-existing local files that aren't documents yet (the watcher
  // ignores files already present at startup, so do this once up front) — but
  // never swallow a vault that's sitting inside ours.
  const adoptUntracked = async (report: boolean): Promise<void> => {
    const toSweep = listMarkdown(dir, ignore);
    let swept = 0;
    for (const path of toSweep) {
      if (report) opts.onProgress?.({ phase: "adopting", done: swept++, total: toSweep.length });
      if (manager.has(path)) continue;
      const foreign = foreignVault(path);
      if (foreign) {
        noteForeign(foreign);
        continue;
      }
      // Creating a document is a network call, and a failed one THROWS — which
      // used to reject startVaultSync and take the whole vault down over one file.
      // Leave it: a later sweep, or the file's next change, tries again.
      try {
        await tryAdopt(path);
      } catch (e) {
        log(`couldn't adopt ${path} yet: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (report) opts.onProgress?.({ phase: "adopting", done: toSweep.length, total: toSweep.length });
  };
  // Offline, every adoption would wait out its timeout for nothing. The catch-up
  // sweep after the first reconcile that reaches the cloud does them instead.
  // The same deferral while the account is unsettled: adopting is the one act
  // that creates documents, and it waits for the first pass that confirms whose
  // vault this is.
  let catchUpAdoption = startedOffline || ownerPending;
  if (!catchUpAdoption) await adoptUntracked(true);

  /**
   * Adopt what a relaxed rule just revealed.
   *
   * Only the difference: re-walking a large vault on every keystroke in the
   * rules file would be its own problem, and a file that was already visible is
   * already tracked.
   */
  const sweepForNewlyVisible = async (before: VaultIgnore): Promise<void> => {
    if (stopped) return;
    for (const path of listMarkdown(dir, ignore)) {
      if (!before.ignores(path)) continue; // it was visible before; nothing new
      if (manager.has(path) || foreignVault(path)) continue;
      await tryAdopt(path);
    }
  };

  const rel = (p: string): string => relative(dir, p).split(sep).join("/");
  /** The tracked path, now gone from disk, whose file `to` is — a rename. */
  const movedFromByInode = (to: string): string | null => {
    const ino = inodeOf(to);
    if (ino === null) return null;
    for (const [path, known] of inodes) {
      if (known === ino && path !== to && manager.has(path) && fs.read(path) === null) return path;
    }
    return null;
  };
  // A removal is held briefly: if a matching add arrives it's a rename, else a delete.
  const pendingRemoval = new Map<string, { content: string; timer: ReturnType<typeof setTimeout> }>();

  /**
   * A vault marker appeared. If it isn't ours, that subtree just stopped being our
   * business mid-flight — the user converted a subfolder into a vault, or dragged
   * one in. Close whatever we hold under it before the next cloud update writes
   * our content into another daemon's tree.
   */
  const onMarkerAdded = (relDir: string): void => {
    if (!myVaultId || relDir === "") return; // our own root marker
    const id = readVaultMarker(join(dir, relDir));
    if (id === null || id === myVaultId) return;
    const closed = manager.closeUnder(relDir);
    if (closed.length > 0) {
      log(`${relDir}/ is another vault now — stopped syncing ${closed.length} file(s) there`);
    }
    noteForeign(relDir);
  };

  /** A marker vanished: that folder is an ordinary folder again, and its files are
   *  ours to adopt — the mirror image of onMarkerAdded. */
  const onMarkerRemoved = (relDir: string): void => {
    if (!myVaultId || relDir === "") return;
    reported.delete(relDir);
    let files: string[];
    try {
      files = listMarkdown(join(dir, relDir), ignore);
    } catch {
      return; // the whole folder went with the marker — nothing to adopt
    }
    log(`${relDir}/ is no longer a vault — its files are ours again`);
    for (const sub of files) {
      const path = `${relDir}/${sub}`;
      // A vault nested deeper inside it is still not ours.
      if (manager.has(path) || foreignVault(path)) continue;
      void tryAdopt(path).catch((e) => log(`adopt ${path} failed: ${String(e)}`));
    }
  };

  const onWrite = (p: string): void => {
    const path = rel(p);
    // The rules changed. Re-read them, then sweep: a pattern the user REMOVED
    // means files that were invisible a moment ago are documents now, and they
    // will not announce themselves — the watcher only reports what changes, and
    // nothing about them did. Adding a pattern needs no sweep; the files it hides
    // are simply never looked at again.
    if (path === IGNORE_FILE) {
      const before = ignore;
      ignore = loadVaultIgnore(dir);
      log(`ignore rules reloaded — ${ignore.size} pattern(s)`);
      void sweepForNewlyVisible(before).catch((e) =>
        log(`couldn't sweep newly visible files: ${String(e)}`)
      );
      return;
    }
    const markerDir = markerDirOf(path);
    if (markerDir !== null) {
      onMarkerAdded(markerDir);
      return; // a marker is never a document
    }
    // We sync markdown as documents. An image or a PDF is not ours to read as
    // text and adopt — but it IS media the vault carries (A6), so hand it to the
    // asset pass rather than dropping it on the floor.
    if (!isMarkdownPath(path)) {
      // TRIGGER A — new bytes. If some document references this path it should go
      // up; the pass works that out. Debounced, so dropping in fifty images is one
      // pass rather than fifty.
      if (isAssetPath(path)) scheduleAssetSync();
      return;
    }
    // A vault nested inside ours is not our business — the same rule git uses to
    // refuse a nested repository. Without this we'd adopt every one of its files
    // as duplicates of documents another daemon already owns.
    const foreign = foreignVault(path);
    if (foreign) {
      noteForeign(foreign);
      return;
    }
    if (manager.has(path)) noteInode(path);
    if (manager.fileChanged(path)) {
      if (readOnlyPaths.has(path)) {
        // Someone wrote through the mode bits — or we did, materializing the
        // file, which the watcher reports exactly the same way. The replica
        // has absorbed it (it may not save); updateForks says whether a fork
        // came of it, and only a write that was not ours is worth a line.
        const wroteAt = written.get(path);
        if (wroteAt === undefined || Date.now() - wroteAt >= SELF_WRITE_MS) {
          log(`${path} changed — it is read-only here, so the change stays local`);
        }
        updateForks();
      } else log(`pushed ${path}`);
      // TRIGGER B — the reference SET may have moved. Adding ![](assets/x.png) to
      // an existing note changes no image at all, so trigger A never fires and the
      // picture would wait for the 15s timer. This branch catches an edit from
      // EITHER direction: a local write, or a cloud update VaultSync just flushed
      // to the file.
      scheduleAssetSync();
      return;
    }
    // Untracked. Before adopting it as a new doc, check whether it's really a
    // move: moving a folder is a single rename(2) on the directory, so the files
    // inside emit no unlink to pair with — we infer it from content, the way git
    // detects renames it never recorded.
    const content = fs.read(path);
    if (content === null) return;
    const from = movedFromByInode(path) ?? manager.findMovedFrom(content, (q) => fs.read(q) !== null);
    if (from) {
      const pending = pendingRemoval.get(from);
      if (pending) {
        clearTimeout(pending.timer);
        pendingRemoval.delete(from);
      }
      if (manager.moveDoc(from, path)) {
        inodes.delete(from);
        noteInode(path);
        log(`moved ${from} → ${path}`);
        // Renamed AND edited in one go (an editor's save-as): the inode paired
        // it, so the new bytes still need to go up.
        if (manager.fileChanged(path)) log(`pushed ${path}`);
        // A path change reshapes the tree just as much as a new file does.
        opts.onDocsChanged?.();
        return;
      }
    }
    void tryAdopt(path).catch((e) => log(`adopt ${path} failed: ${String(e)}`));
  };

  const onUnlink = (p: string): void => {
    const path = rel(p);
    const markerDir = markerDirOf(path);
    if (markerDir !== null && markerDir !== "") {
      onMarkerRemoved(markerDir);
      return;
    }
    if (foreignVault(path)) return; // a nested vault's file: never ours to restore
    // If our own root vanished (the user moved the whole vault), restoring would
    // recreate thousands of files at a path they deliberately abandoned. Stop.
    if (myVaultId && readVaultMarker(dir) !== myVaultId) {
      log("this vault's folder is gone or no longer ours — stopping instead of restoring");
      void stop();
      return;
    }
    if (markerDir === "") return; // our own marker, root still intact — not a doc
    const content = manager.markdownOf(path);
    if (content === null) return; // untracked
    // Defer the restore: a rename's add should re-key instead of recreating the file.
    const timer = setTimeout(() => {
      pendingRemoval.delete(path);
      void applyLocalDelete(path);
    }, 300);
    pendingRemoval.set(path, { content, timer });
  };

  /**
   * A file is gone from disk. Delete the document it stood for.
   *
   * The folder is the vault — deleting a note in Finder deletes the note, the
   * way it does in Obsidian. This used to restore the file instead, on the view
   * that the cloud was the truth and a missing file was an accident. It made
   * deletion impossible from anywhere but the app, and it did so silently.
   *
   * Three things are checked first, because "the file is not there" has innocent
   * causes and this one is destructive:
   *
   *  - it is really gone. Some editors save by writing a temp file, unlinking the
   *    original and renaming — the unlink is real and the file is back a moment
   *    later. (A rename is already handled before this runs: an add that matches
   *    a pending removal re-keys the document instead.)
   *  - the vault's own marker is still ours. A folder that was unmounted or
   *    moved emits an unlink for every file in it, and none of those is a
   *    deletion. This is the check that catches a disk going away, and it is
   *    the reason there is no limit on HOW MANY may go at once: deleting fifty
   *    notes is still fifty deletions, and refusing them past some count would
   *    put files back that the user meant to remove.
   *  - we hold the document at all. An untracked file is not ours to delete.
   *
   * If the server cannot be told, the file comes back and says why. Leaving it
   * deleted locally would be a lie: the document still exists, and the next
   * reconcile would rematerialise it anyway with no explanation.
   */
  const applyLocalDelete = async (path: string): Promise<void> => {
    if (fs.read(path) !== null) return; // came back on its own
    if (myVaultId && readVaultMarker(dir) !== myVaultId) return; // the folder went, not the file
    const id = manager.docIdOf(path);
    if (id === null) return;

    let deleted = false;
    try {
      deleted = await deleteDoc(id);
    } catch (e) {
      log(`couldn't delete the document for ${path}: ${String(e)}`);
    }
    if (deleted) {
      manager.closeDoc(path);
      readOnlyPaths.delete(path);
      log(
        shared
          ? `deleted ${path} — you have left that share; the owner's document is untouched`
          : `deleted ${path} — its document is in the trash and can be restored`
      );
      opts.onDocsChanged?.();
      updateForks();
      return;
    }
    manager.fileRemoved(path); // restore
    log(
      shared
        ? `couldn't leave the share for ${path} — put the file back`
        : `couldn't delete the document for ${path} — put the file back`
    );
  };

  // Dotfiles are noise — except the vault marker, which is how a boundary
  // announces itself while we're running.
  /**
   * Ask the cloud what it says now, and apply the difference.
   *
   * Paths were resolved once at startup, so a move or convert made on the web was
   * invisible until a restart — and until then we kept writing each doc at its
   * stale path, leaving files in two places for the next startup to adopt as
   * duplicates. Nothing pushes a path change at us (the CRDT channel carries a
   * document's CONTENT, not where it lives), so we ask.
   */
  // Resolves false when the cloud couldn't be asked, so the loop can back off.
  const reconcile = async (): Promise<boolean> => {
    if (stopped) return true;
    // Defence in depth. The heartbeat notices a takeover on its own schedule; this
    // is the pass that MOVES and TRASHES files, so it re-checks before acting
    // rather than trusting a claim made up to a heartbeat ago.
    if (lock && !lock.heartbeat()) return true;
    // The account was unsettled at start (offline, or /me did not answer).
    // Nothing below acts on the cloud's word until it is: a vault recorded for
    // another account stops here, and one that still cannot be settled waits
    // for the next pass.
    if (ownerPending && myVaultId) {
      const settled = await settleOwner();
      if (settled === "not-ours" || settled === "deleted") {
        const why =
          settled === "not-ours"
            ? new VaultNotOursError(myVaultId, recordedOwnerOf({ vaultId: myVaultId, dir }), keyOwner)
            : new VaultGoneError(myVaultId);
        log(`${why.message} — stopping`);
        void stop();
        return true;
      }
      if (settled === "unknown") return false;
      ownerPending = false;
      if (settled === "unbound-shared") {
        // The key's owner is known now; the listing below says whose folder.
        sharedUnbound = true;
      } else {
        await recordMountOwner(myVaultId, dir, settled.owner);
        log("confirmed: this vault belongs to the signed-in account");
      }
    }
    // Snapshot BEFORE the fetch: anything adopted while it's in flight is legitimately
    // absent from the reply, and must not be read as "deleted". See planReconcile.
    // Before the fetch, not after: retrying a rename changes what the cloud will
    // say, and a plan built from a snapshot taken before it landed would move the
    // file back to a path that is no longer current — undoing the rename for one
    // pass and then undoing that. Ask first, then look.
    await paths.retry();

    const knownBefore = new Set(manager.refs().map((r) => r.id));
    let docs: DocSummary[];
    try {
      docs = await fetchDocs(false);
    } catch (e) {
      // Never act on a failed fetch: an error is not "the cloud has nothing", and
      // treating it as such would retire every file in the vault.
      log(`couldn't refresh from the cloud: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
    if (stopped) return true;
    // Started offline with the Shared Vault unbound: this is the first listing.
    if (sharedUnbound) {
      if (keyOwner === null && opts.ownerId === undefined) {
        keyOwner = (await resolveWorkerConnection(appUrl, apiKey))?.ownerId ?? null;
      }
      if (keyOwner === null) return false;
      if (bindSharedByListing(docs) === "not-ours") {
        log(`${sharedNotOurs().message} — stopping`);
        void stop();
        return true;
      }
      sharedUnbound = false;
      await recordMountOwner(myVaultId as string, dir, keyOwner);
      log("confirmed: the Shared Vault here belongs to the signed-in account");
    }
    // See EMPTY_LISTING_GUARD_AT: a vault holding documents that is suddenly
    // listed as empty is the wrong account or a broken answer. Acting on it
    // would retire every file and then adopt them all back as new documents.
    if (!shared && docs.length === 0 && knownBefore.size >= EMPTY_LISTING_GUARD_AT) {
      log(emptyListingMessage(knownBefore.size, dir));
      return false;
    }

    const nextRefs = assignPaths(docs);
    // Refresh who owns which path. Safe here and only here: we returned above if
    // the fetch failed, so this list is one the cloud actually gave us. A doc that
    // has really gone releases its path now, which is what lets a deleted-then-
    // recreated file be adopted again.
    manager.setClaims(nextRefs);
    lastDocs = docs;
    lastRefs = nextRefs;
    writeIndex();

    const plan = planReconcile(manager.refs(), nextRefs, knownBefore);

    for (const mv of plan.move) {
      // A rename this machine made and has not managed to save yet. The cloud
      // still knows the old path, but it is the one that is out of date — moving
      // the file back would undo what the user did in Finder.
      if (paths.pending(mv.id)) continue;
      const intoForeign = foreignVault(mv.to);
      if (intoForeign) {
        // Its new home is inside another vault's tree — theirs to write, not ours.
        manager.closeDoc(mv.from);
        noteForeign(intoForeign);
        continue;
      }
      // Rename in place: the file keeps its inode, and nothing lands in .trash.
      // A title typed in the editor arrives here once per pause in typing, and
      // writing each one afresh left a .trash copy of every intermediate name.
      if (fs.read(mv.from) !== null) {
        if (fs.rename && fs.read(mv.to) === null) fs.rename(mv.from, mv.to);
        else {
          fs.write(mv.to, fs.read(mv.from) as string);
          fs.trash(mv.from);
        }
      }
      manager.moveDoc(mv.from, mv.to, { persist: false }); // the cloud told us; don't echo it back
      noteInode(mv.to);
      log(`moved ${mv.from} → ${mv.to} (from the cloud)`);
    }

    for (const c of plan.close) {
      manager.closeDoc(c.path);
      // It's gone from this vault — deleted, or converted into another one; in
      // the Shared Vault, no longer shared with this person. Retire the file
      // rather than leave it for the next startup to adopt as a new doc. Trash,
      // never a hard delete: the content is still the user's, and a fork in it
      // is the one copy of their edits.
      readOnlyPaths.delete(c.path);
      disk.setReadOnly(c.path, false);
      fs.trash(c.path);
      log(
        shared
          ? `${c.path} is no longer shared with you — moved to .trash`
          : `${c.path} is no longer in this vault — moved to .trash`
      );
    }

    for (const o of plan.open) {
      const foreign = foreignVault(o.path);
      if (foreign) {
        noteForeign(foreign);
        continue;
      }
      // One doc failing to open must NOT crash the whole reconcile (and take the
      // daemon down with it). Two very different things land here: a doc deleted
      // between the list and this open (seeding its CRDT violates the doc_crdt
      // foreign key), and a snapshot fetch that died in transit. Neither needs to
      // be told apart, because skipping is right for both — the doc stays claimed,
      // so nothing adopts its file, and it is back in plan.open next pass. The
      // deleted one drops off the list and releases its path; the interrupted one
      // opens on a later try.
      try {
        // The reconcile list carries no content, so fetch this doc's markdown now —
        // it's only needed to seed a doc the cloud has no CRDT for, and plan.open is
        // just the (usually zero) newly-appeared docs, not every doc every 15s.
        const seed = o.seed ?? (await fetchDocContent(appUrl, apiKey, o.id)) ?? undefined;
        await manager.openDoc({ ...o, seed });
        noteInode(o.path);
        log(`opened ${o.path}${o.readOnly ? " (read-only)" : ""}`);
      } catch (e) {
        log(`couldn't open ${o.path}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // A capability that changed between lists: a viewer made an editor keeps
    // their fork and sends it up in one save; an editor made a viewer stops
    // saving. The file's mode bits follow.
    for (const r of nextRefs) {
      if (manager.docIdOf(r.path) !== r.id) continue;
      const readOnly = r.readOnly === true;
      if (manager.setReadOnly(r.path, readOnly) && readOnly !== readOnlyPaths.has(r.path)) {
        log(`${r.path} is ${readOnly ? "read-only" : "editable"} for you now`);
      }
    }
    applyReadOnly(nextRefs);
    updateForks();
    return true;
  };

  /**
   * The Shared Vault's media (download only).
   *
   * Each shared document's images live in its OWNER's vault, and that vault's
   * media list is not this person's to see — so the API is asked per document
   * for exactly what its markdown references (GET /assets?doc=). A reference is
   * resolved twice: against the owner's path, to find it in their vault, and
   * against the member's path here, to know where to write it. Nothing is
   * uploaded: an image added beside a shared document here has no vault of ours
   * to go to, and a viewer could not send one anyway. Nothing is ever deleted.
   */
  const sharedAssetLists = new Map<string, { etag: string | null; assets: Array<{ path: string; sha256: string }> }>();
  const reconcileSharedAssets = async (): Promise<boolean> => {
    if (stopped) return true;
    const onDisk = new Map(listDiskAssets(dir, assetHashes, ignore).map((a) => [a.path, a.sha256]));
    let ok = true;
    for (const r of manager.refs()) {
      if (stopped) return true;
      const doc = lastDocs.find((d) => d.id === r.id);
      const markdown = manager.markdownOf(r.path);
      if (!doc || markdown === null) continue;
      // (owner's path in their vault, path here) for every reference that
      // resolves on both sides.
      const pairs: Array<{ cloud: string; local: string }> = [];
      for (const raw of rawRefsIn(markdown)) {
        const cloud = resolveRef(doc.owner_path ?? "untitled.md", raw);
        const local = resolveRef(r.path, raw);
        if (cloud && local && !ignore.ignores(local)) pairs.push({ cloud, local });
      }
      if (pairs.length === 0) continue;
      const cached = sharedAssetLists.get(r.id);
      const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}` };
      if (cached?.etag) headers["If-None-Match"] = cached.etag;
      let listed = cached;
      try {
        const res = await fetchWithTimeout(`${appUrl}/api/v1/assets?doc=${encodeURIComponent(r.id)}&urls=0`, { headers });
        if (res.status !== 304) {
          if (!res.ok) throw new Error(`couldn't list media (${res.status})`);
          const body = (await res.json()) as { assets?: Array<{ path: string; sha256: string }> };
          listed = { etag: res.headers.get("etag"), assets: body.assets ?? [] };
          sharedAssetLists.set(r.id, listed);
        }
      } catch (e) {
        log(`couldn't list media for ${r.path}: ${e instanceof Error ? e.message : String(e)}`);
        ok = false;
        continue;
      }
      if (!listed) continue;
      const missing = pairs.filter((p) => {
        const cloud = listed?.assets.find((a) => a.path === p.cloud);
        return cloud !== undefined && onDisk.get(p.local) !== cloud.sha256;
      });
      if (missing.length === 0) continue;
      // Signed URLs only now, and only for this document.
      let signed: Array<{ path: string; url: string | null }> = [];
      try {
        const res = await fetchWithTimeout(`${appUrl}/api/v1/assets?doc=${encodeURIComponent(r.id)}`, {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (!res.ok) throw new Error(`couldn't list media (${res.status})`);
        signed = ((await res.json()) as { assets?: Array<{ path: string; url: string | null }> }).assets ?? [];
      } catch (e) {
        log(`couldn't list media for ${r.path}: ${e instanceof Error ? e.message : String(e)}`);
        ok = false;
        continue;
      }
      for (const m of missing) {
        const url = signed.find((a) => a.path === m.cloud)?.url;
        if (!url) continue;
        try {
          const res = await fetchWithTimeout(url, { timeoutMs: TRANSFER_TIMEOUT_MS });
          if (!res.ok) continue;
          writeAsset(dir, m.local, new Uint8Array(await res.arrayBuffer()));
          log(`fetched ${m.local}`);
        } catch (e) {
          log(`couldn't fetch ${m.local}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
    return ok;
  };

  /**
   * Bring the folder's media in line with the cloud's (roadmap A6).
   *
   * A document's markdown says `![d](assets/d.png)`, so the FILE has to be here or
   * the vault is only half a vault — the whole point is that Obsidian, offline,
   * renders it. Assets are opaque bytes with no CRDT, so this is a plain diff:
   * fetch what's missing, send up what's new.
   *
   * Deliberately not deleting anything. See planAssetSync — an asset has no CRDT
   * to be restored from, so removing a local file because a row vanished is
   * unrecoverable.
   */
  // Survives across passes on purpose — that is the entire point. Scoped to this
  // daemon, so stopping a vault drops it and a restart re-reads from disk.
  const assetHashes: AssetHashMemo = new Map();
  // The last list the cloud gave us. Also survives across passes: a 304 means
  // "still this", and nearly every pass gets one.
  let cloudAssetList: CloudAssetList | undefined;

  // Resolves false when the cloud couldn't be asked, so the loop can back off.
  const reconcileAssets = async (): Promise<boolean> => {
    if (stopped || !myVaultId) return true; // legacy single-vault mode has no vault to scope to
    if (shared) return reconcileSharedAssets();
    try {
      const fresh = await listCloudAssets(appUrl, apiKey, myVaultId, {
        urls: false,
        etag: cloudAssetList?.etag ?? undefined,
      });
      if (fresh) cloudAssetList = fresh;
    } catch (e) {
      log(`couldn't list media: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
    if (stopped || !cloudAssetList) return true;
    const cloudAssets = cloudAssetList.assets;

    // A nested vault's media is its own daemon's business, exactly like its docs.
    //
    // The ignore rules are applied to the CLOUD list too, and that is not
    // symmetry for its own sake — it is a live bug without it. The disk scan
    // skips ignored paths, so an asset uploaded into one before the rules
    // existed looks MISSING locally on every pass, and the download half
    // faithfully fetches it back into node_modules. Forever. This vault had 44
    // such rows and the daemon was writing editor.md fonts into the user's
    // dependency tree when I caught it.
    const mine = cloudAssets.filter((a) => !foreignVault(a.path) && !ignore.ignores(a.path));
    const plan = planAssetSync(
      mine,
      listDiskAssets(dir, assetHashes, ignore).filter((a) => !foreignVault(a.path))
    );

    // Signed URLs only for what's about to be fetched, and only when something is.
    let signed: CloudAssetList["assets"] = [];
    if (plan.download.length > 0) {
      try {
        signed = (await listCloudAssets(appUrl, apiKey, myVaultId, { urls: true }))?.assets ?? [];
      } catch (e) {
        log(`couldn't list media: ${e instanceof Error ? e.message : String(e)}`);
        return false;
      }
    }
    for (const a of plan.download) {
      const url = signed.find((c) => c.path === a.path)?.url;
      if (!url) continue;
      try {
        const res = await fetchWithTimeout(url, { timeoutMs: TRANSFER_TIMEOUT_MS });
        if (!res.ok) continue;
        writeAsset(dir, a.path, new Uint8Array(await res.arrayBuffer()));
        log(`fetched ${a.path}`);
      } catch (e) {
        log(`couldn't fetch ${a.path}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // Upload ONLY what a document asks for.
    //
    // Every image in the folder used to go up, which for a source repo meant
    // 3,179 files and 791 MB — 21 of them referenced by any document. The
    // markdown states which files it needs; nothing else has to be guessed.
    // Computed from the CRDTs in memory (2 ms), so it reflects an edit that
    // arrived from the cloud and has not reached disk yet.
    const wanted = referencedAssets(
      manager.refs().map((r) => ({ path: r.path, markdown: manager.markdownOf(r.path) ?? "" }))
    );
    for (const path of plan.upload) {
      if (!wanted.has(path)) continue; // in the folder, but no document wants it
      const bytes = readAsset(dir, path);
      if (bytes === null) continue; // vanished mid-sync
      // Per-file try/catch. uploadAsset THROWS on a network failure rather than
      // returning false, and reconcileAssets is called as `void reconcileAssets()`
      // — so one failed fetch escaped as an unhandled rejection and took the rest
      // of the pass with it. On a saturated link that produced 8,668 of them.
      try {
        if (await uploadAsset(appUrl, apiKey, myVaultId, path, bytes)) log(`uploaded ${path}`);
        else log(`couldn't upload ${path}`);
      } catch (e) {
        log(`couldn't upload ${path}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    // The DOWNLOAD half above is unconditional. An image attached in the app is still
    // written into the folder, so ![](assets/x.png) renders offline in Obsidian.
    return true;
  };

  // Copying a folder of images fires an event per file, and each would otherwise
  // start its own full pass. Coalesce them into one.
  let assetTimer: ReturnType<typeof setTimeout> | undefined;
  const scheduleAssetSync = (): void => {
    if (assetTimer) clearTimeout(assetTimer);
    assetTimer = setTimeout(
      () => void reconcileAssets().catch((e) => log(`media sync failed: ${String(e)}`)),
      500
    );
  };

  // One pass at a time, the next scheduled when this one finishes. setInterval
  // fired every 15 s whether or not the last pass had come back, so when requests
  // hung for 90 s, six passes per vault piled up. And a pass that can't reach the
  // cloud makes the next one wait longer (nextPollDelay): polling a failing
  // server at full rate is what kept it down on 2026-09-13.
  const reconcileMs = opts.reconcileMs ?? 15_000;
  let reconcileTimer: ReturnType<typeof setTimeout> | undefined;
  let failedPasses = 0;
  const schedulePass = (): void => {
    if (stopped || reconcileMs <= 0) return;
    const delay = nextPollDelay(reconcileMs, failedPasses);
    reconcileTimer = setTimeout(() => {
      void (async () => {
        // Both catch. reconcile() did not, and it is the pass that talks to the
        // cloud every fifteen seconds — so an outage rejected it with a
        // PostgREST error object, which nothing caught, which killed the whole
        // service. It only ever guarded its own fetch; everything after that
        // was free to throw.
        const [docsOk, mediaOk] = await Promise.all([
          reconcile().catch((e) => {
            log(`reconcile failed: ${String(e)}`);
            return false;
          }),
          reconcileAssets().catch((e) => {
            log(`media sync failed: ${String(e)}`);
            return false;
          }),
        ]);
        // Started offline: files made in the meantime couldn't become documents
        // then. The cloud just answered, so now they can.
        if (docsOk && catchUpAdoption && !stopped) {
          catchUpAdoption = false;
          await adoptUntracked(false).catch((e) => log(`catch-up adoption failed: ${String(e)}`));
        }
        failedPasses = docsOk && mediaOk ? 0 : failedPasses + 1;
        if (failedPasses > 0) {
          const next = nextPollDelay(reconcileMs, failedPasses);
          log(`cloud unreachable — trying again in ${Math.round(next / 1000)}s`);
        }
        schedulePass();
      })();
    }, delay);
  };

  // One recursive handle on the root (see fs-watcher). The markdown already
  // here is "known", so a file deleted later is an unlink rather than nothing.
  const watcher: VaultWatcher = opts.watch
    ? opts.watch(dir)
    : watchVault(dir, {
        ignored: (p) => ignoredByWatcher(p, ignore),
        known: listMarkdown(dir, ignore),
        log,
      });
  let stopped = false;

  // History for the files edited on THIS machine.
  //
  // The browser records versions for the document it has open, and the API for
  // the edits it makes — but nothing recorded what you typed in Obsidian. That
  // was harmless only while the browser's author was empty: the moment it names
  // a person, the browser's ticker would credit a file synced up from here to
  // whoever happened to have the doc open. So the daemon records its own.
  //
  // One timer for the whole vault rather than one per document: each doc decides
  // whether it is due, and ignores changes that arrived from the cloud.
  const checkpointMs = opts.checkpointMs ?? 30_000;
  let checkpointTimer: ReturnType<typeof setInterval> | undefined;
  if (checkpointMs > 0) {
    checkpointTimer = setInterval(() => {
      if (stopped) return;
      try {
        // Settle any file that read as empty since the last sweep. By now a
        // truncate-then-write has finished, so anything still empty was cleared
        // on purpose — and anything refilled is applied as the ordinary edit it
        // always was.
        const emptied = manager.confirmPendingEmpties();
        if (emptied > 0) {
          log(`confirmed ${emptied} emptied file(s)`);
          updateForks();
        }
        const n = manager.checkpointDue();
        if (n > 0) log(`recorded ${n} version(s)`);
      } catch (e) {
        // Keeping history is never worth taking sync down for.
        log(`couldn't record versions: ${e instanceof Error ? e.message : String(e)}`);
      }
    }, checkpointMs);
  }

  const stop = async (): Promise<void> => {
    lock?.release();
    if (stopped) return;
    stopped = true;
    log("stopping…");
    if (reconcileTimer) clearTimeout(reconcileTimer);
    if (assetTimer) clearTimeout(assetTimer);
    if (checkpointTimer) clearInterval(checkpointTimer);
    for (const { timer } of pendingRemoval.values()) clearTimeout(timer);
    pendingRemoval.clear();
    // Timed, so the log says when a stop was slow. One watch handle per vault
    // now; closing it is the cheap part.
    const t0 = Date.now();
    await watcher.close();
    manager.closeAll();
    transport.close();
    log(`stopped (${Date.now() - t0}ms)`);
  };
  stopBox.stop = stop; // the lock's onLost calls this

  watcher.on("add", onWrite);
  watcher.on("change", onWrite);
  watcher.on("unlink", onUnlink);

  // Pull the vault's media once at startup, so images are there without waiting a
  // whole interval. This has to come after `stopped` and the watcher exist: called
  // any earlier it reads `stopped` from its temporal dead zone and throws, taking
  // the whole daemon down with it. Not awaited — a slow bucket must not hold up a
  // vault whose documents are already syncing.
  void reconcileAssets().catch((e) => log(`media sync failed: ${String(e)}`));
  schedulePass(); // same reason: it reads `stopped`

  return stop;
}
