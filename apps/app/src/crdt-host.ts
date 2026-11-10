// The desktop window's snapshot cache — local disk in front of the cloud.
//
// The editor in the renderer is a CRDT peer: it needs the document's Yjs bytes,
// not rendered content. Until now it fetched those from Supabase itself, and
// that one request was what stood between clicking a document and seeing it.
//
// This process answers instead, from a file on disk — microseconds, no network —
// and refreshes from the cloud behind the answer.
//
// The cloud is the web API, reached with this machine's key (security lockdown
// stage 2): the renderer no longer holds a database credential, and neither
// does this process. The API merges every save server-side and answers "what
// changed" for the documents this account can see, which is how edits made
// elsewhere reach an open window: this process polls that feed for the
// documents its windows are watching and pushes each newer snapshot down.
// Until stage 2 the renderer kept its own Realtime connection for that, joined
// anonymously with the publishable key — the thing stage 2 closes.
//
// It caches the CRDT BYTES, not markdown. That distinction is why this is safe:
// a Y.Doc rebuilt from markdown is a different document as far as Yjs is
// concerned — same text, unrelated history — and merging it with the cloud's
// copy duplicates the content instead of converging. The vault's `.md` files
// stay what they are, a projection for humans and other tools.
//
// It holds no Y.Doc of its own. It moves bytes and remembers them; the peers are
// still the renderer's replica and the vault daemon's.

import { app } from "electron";
import type { WebContents } from "electron";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ApiCrdtTransport, bearerCrdtRequest } from "@markbase/docs/crdt-api";
import { fetchWithTimeout } from "@markbase/protocol/timeout-fetch";

let transport: ApiCrdtTransport | null = null;

/**
 * Where this file's failures go.
 *
 * There was nowhere. Every catch here was empty, so a document served from a
 * stale cache whose refresh failed showed old text indefinitely with no record
 * anywhere — not in the log, not on screen. Diagnosing it meant reading the
 * snapshot off disk and decoding it by hand, which is not a thing a user can do
 * and not a thing support should have to.
 */
let log: (message: string) => void = () => {};

/**
 * Point the cache at the API, and give it somewhere to report.
 *
 * The key is read on every request rather than captured: it is written after
 * sign-in and cleared on sign-out, and a window open across either must follow.
 */
export function configureCrdtHost(
  appUrl: string,
  apiKey: () => string | null,
  onLog?: (message: string) => void
): void {
  if (onLog) log = onLog;
  transport?.close();
  transport = new ApiCrdtTransport(
    bearerCrdtRequest(appUrl, apiKey, (url, init) => fetchWithTimeout(url, init)),
    {
      onRetry: (attempt, message) =>
        log(`crdt: retrying the cloud snapshot (attempt ${attempt}): ${message}`),
      log: (m) => log(`crdt: ${m}`),
    }
  );
}

function cloud(): ApiCrdtTransport {
  if (!transport) throw new Error("crdt-host: configureCrdtHost was never called");
  return transport;
}

/** The cloud's snapshot for a document, or null when it has none. Throws on failure. */
function cloudLoad(docId: string): Promise<Uint8Array | null> {
  return cloud().store.load(docId);
}

/** Write a snapshot back. Throws on failure. */
function cloudSave(docId: string, bytes: Uint8Array): Promise<void> {
  return cloud().store.save(docId, bytes);
}

function cacheDir(): string {
  return join(app.getPath("userData"), "crdt");
}

/** Document ids are uuids; refuse anything that could escape the directory. */
function snapshotPath(docId: string): string {
  return join(cacheDir(), `${docId.replace(/[^a-zA-Z0-9-]/g, "")}.bin`);
}

/**
 * Say a degradation ONCE per run.
 *
 * These failures are individually harmless — an unreadable or unwritable cache
 * costs a round trip, never correctness — which is why they were swallowed. But
 * a permission or disk problem makes them permanent, and then every open is slow
 * for a reason nobody can see. Once is enough to explain that; per-open would
 * flood the log with a line that says the same thing.
 */
const warned = new Set<string>();
function warnOnce(kind: string, message: string): void {
  if (warned.has(kind)) return;
  warned.add(kind);
  log(message);
}

function readCached(docId: string): Uint8Array | null {
  try {
    const path = snapshotPath(docId);
    return existsSync(path) ? new Uint8Array(readFileSync(path)) : null;
  } catch (e) {
    // An unreadable cache just means we ask the cloud, as we did before this
    // existed. Never an error — but if it is unreadable EVERY time, every open
    // pays the network and nothing says why.
    warnOnce(
      "read",
      `crdt: cannot read the local snapshot cache — opens will hit the network: ${
        e instanceof Error ? e.message : String(e)
      }`
    );
    return null;
  }
}

function writeCached(docId: string, bytes: Uint8Array): void {
  try {
    mkdirSync(cacheDir(), { recursive: true });
    writeFileSync(snapshotPath(docId), bytes);
  } catch (e) {
    // Losing the cache costs speed on the next open, never correctness. Said
    // once, because a full disk or a bad permission makes it permanent.
    warnOnce(
      "write",
      `crdt: cannot write the local snapshot cache — every open will hit the network: ${
        e instanceof Error ? e.message : String(e)
      }`
    );
  }
}

/** Renderers waiting to hear about a document, and the feed that tells us. */
interface Watch {
  renderers: Set<WebContents>;
  /** Stop hearing about this document from the API's change feed. */
  unsubscribe: () => void;
}
const watchers = new Map<string, Watch>();

function watch(docId: string, wc: WebContents): void {
  let w = watchers.get(docId);
  if (!w) {
    // Subscribed for as long as any window has the document open. The feed
    // delivers whole snapshots; cached and pushed down like a refresh.
    const unsubscribe = cloud().pubsub.subscribe(docId, (snapshot) => {
      writeCached(docId, snapshot);
      fanOut(docId, snapshot);
    });
    w = { renderers: new Set(), unsubscribe };
    watchers.set(docId, w);
  }
  w.renderers.add(wc);
}

function unwatch(docId: string, wc: WebContents): void {
  const w = watchers.get(docId);
  if (!w) return;
  w.renderers.delete(wc);
  if (w.renderers.size === 0) {
    w.unsubscribe();
    watchers.delete(docId);
  }
}

/**
 * Hand a snapshot down to the renderers watching this document.
 *
 * They apply it as an ordinary Yjs update, which is a MERGE, not a replacement —
 * so a renderer that was served a stale cache catches up without losing anything
 * typed in the meantime.
 */
function fanOut(docId: string, snapshot: Uint8Array): void {
  const w = watchers.get(docId);
  if (!w) return;
  for (const wc of w.renderers) {
    if (wc.isDestroyed()) w.renderers.delete(wc);
    else wc.send(`crdt:update:${docId}`, Buffer.from(snapshot));
  }
}

/** Cloud refreshes in flight, so N renderers opening a doc make one request. */
const refreshing = new Set<string>();

/**
 * Tell watchers where a refresh has got to, so a stale answer can say so.
 *
 * Serving the cache first is invisible when it works AND when it does not: a
 * document edited elsewhere shows its old text for as long as the round trip
 * takes, and if that request FAILS it shows the old text forever, silently. The
 * renderer cannot tell those apart without being told.
 */
function announce(docId: string, state: "start" | "done" | "failed"): void {
  const w = watchers.get(docId);
  if (!w) return;
  for (const wc of w.renderers) {
    if (wc.isDestroyed()) w.renderers.delete(wc);
    else wc.send(`crdt:refresh:${docId}`, state);
  }
}

function refreshFromCloud(docId: string): void {
  if (refreshing.has(docId)) return;
  refreshing.add(docId);
  announce(docId, "start");
  void cloudLoad(docId)
    .then((cloud) => {
      if (cloud) {
        writeCached(docId, cloud);
        fanOut(docId, cloud);
      }
      announce(docId, "done");
    })
    .catch((e) => {
      // Offline: the renderer works from the cache and whatever it types, and
      // the change feed catches it up when the network returns. But it is now
      // SAID, twice — to the user as a badge, and here, with the reason.
      // "Couldn't reach the cloud" and "that document 403s" look identical on
      // screen and need different fixes.
      log(
        `crdt: showing a cached copy of ${docId} — refresh failed: ${
          e instanceof Error ? e.message : String(e)
        }`
      );
      announce(docId, "failed");
    })
    .finally(() => refreshing.delete(docId));
}

/**
 * `DocStore.load` for the renderer. Served from disk when we have it, with a
 * cloud refresh started behind the answer; only the first time this machine has
 * ever seen the document does it wait on the network.
 *
 * `null` means "no snapshot anywhere", which the renderer treats as "seed me" —
 * so a failed network read must NEVER be reported as null. It throws instead.
 */
export async function crdtLoad(docId: string, wc: WebContents): Promise<Uint8Array | null> {
  watch(docId, wc);
  const cached = readCached(docId);
  if (cached) {
    refreshFromCloud(docId);
    return cached;
  }
  const cloud = await cloudLoad(docId); // throws on failure — deliberately
  if (cloud) writeCached(docId, cloud);
  return cloud;
}

/**
 * Do we already hold this document's snapshot?
 *
 * The window asks before rendering a document from local data alone. It must be
 * a real answer: if we have no snapshot, opening the editor early would let it
 * seed an EMPTY CRDT over a document whose content lives in its row.
 */
export function crdtHas(docId: string): boolean {
  return existsSync(snapshotPath(docId));
}

/** `DocStore.save`: cache it, then persist to the cloud. */
export async function crdtSave(docId: string, bytes: Uint8Array): Promise<void> {
  writeCached(docId, bytes);
  await cloudSave(docId, bytes);
}

/** A renderer stopped watching a document. */
export function crdtRelease(docId: string, wc: WebContents): void {
  unwatch(docId, wc);
}

/** Drop everything a closing window was watching. */
export function crdtReleaseAll(wc: WebContents): void {
  for (const docId of [...watchers.keys()]) unwatch(docId, wc);
}
