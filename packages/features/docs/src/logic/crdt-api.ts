// The CRDT transport over the web API (security lockdown stage 2).
//
// Every client used to read and write docs.doc_crdt itself, with the
// publishable key, and that key is in every browser bundle and every npm
// install. Now a client holds nothing the database recognises: it asks the API
// for a document's snapshot and hands the API its own, and the API — which
// knows who is asking and what they may do to that document — reads and writes
// the row with the secret key, merging rather than overwriting.
//
// This is the client half, for anything that can make an authenticated request:
//   • the vault daemon (CLI and desktop main process), with its API key;
//   • the desktop main process on behalf of its windows (crdt-host.ts);
//   • the website for a share-link guest, with the share token;
//   • the website for a signed-in user, for the STORE half only — its live
//     deltas still travel on Realtime, because a browser session can join a
//     private channel and a daemon cannot (see crdt-supabase.ts).
//
// Receiving without Realtime means polling. `GET /docs/crdt/changes` answers
// "which snapshots moved since <cursor>" for everything the caller can see, one
// cheap request per vault per poll; a document that moved is then fetched and
// applied as an ordinary update (a full snapshot merges like any delta). A
// client that cannot call that endpoint — a guest, who is nobody at account
// level — polls the one document it has instead.
//
// The retry rules are the daemon's own (`retryingDb`): a 5xx or a dropped
// connection is tried again, a 403 or a 404 is reported at once, and a save is
// a merge, so repeating one is harmless.

import type { DocPubSub, DocStore } from "./transport";
import { retryingDb, type DbResult } from "./db-retry";
import { base64ToBytes, bytesToBase64 } from "./crdt-supabase";

/**
 * A request to the API, path-relative (`/api/v1/...`). Whoever builds the
 * transport decides where the API is and which credential rides along — a
 * bearer key, a cookie, a share token.
 */
export type CrdtRequest = (
  path: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string }
) => Promise<Response>;

/** What `GET /docs/:id/crdt` answers. */
export interface CrdtSnapshotResponse {
  /** Base64 Yjs state; null when the cloud has no snapshot yet. */
  state?: string | null;
  version: number;
  /** Set when `after` was given and nothing newer exists; `state` is omitted. */
  unchanged?: boolean;
}

/** What `GET /docs/crdt/changes` answers. */
export interface CrdtChangesResponse {
  cursor: string;
  changes: Array<{ doc_id: string; version: number }>;
}

/** How often to ask what moved. Each ask is one small request. */
export const CRDT_POLL_MS = 4_000;
/** The longest a failing poll loop waits between asks. */
const CRDT_POLL_MAX_MS = 60_000;

export interface ApiCrdtTransportOptions {
  /** Scope the changes feed to one of the user's own vaults (the daemon syncs one folder). */
  vaultId?: string;
  /**
   * Scope the changes feed to the documents shared WITH the user — their
   * Shared Vault. Exclusive with `vaultId`: a shared document lives in its
   * owner's vault, so a vault scope never covers it.
   */
  scope?: "shared";
  /**
   * Poll each subscribed document on its own instead of the changes feed —
   * for a caller with no account to list changes for (a share-link guest).
   */
  perDoc?: boolean;
  pollMs?: number;
  /** Told about each retry, so a degraded link is visible rather than silent. */
  onRetry?: (attempt: number, message: string) => void;
  /** Where a failed poll is reported. Polls back off and try again regardless. */
  log?: (message: string) => void;
}

/**
 * Turn an API response into the shape `retryingDb` judges: a non-2xx is an
 * error carrying its status, and an HTTP code that says "that is a permanent
 * answer" (`HTTP_403`) so the retry rule never tries it again; a thrown fetch
 * is caught by retryingDb itself, and an exception without a code IS a reason
 * to retry — the request never got an answer.
 */
async function asDbResult<T>(res: Response): Promise<DbResult<T>> {
  const text = await res.text();
  if (!res.ok) {
    return {
      data: null as T,
      error: { message: `${res.status} ${text.slice(0, 200)}`, code: `HTTP_${res.status}` },
      status: res.status,
    };
  }
  return { data: (text ? JSON.parse(text) : {}) as T, error: null, status: res.status };
}

/**
 * The store and the pub/sub, sharing what they know: a save learns the new
 * version, and the poller skips a change it already holds.
 */
export class ApiCrdtTransport {
  readonly store: DocStore;
  readonly pubsub: DocPubSub;

  /** The latest version of each document this client has loaded or saved. */
  private readonly versions = new Map<string, number>();
  private readonly subs = new Map<string, Set<(update: Uint8Array) => void>>();
  private cursor: string | null = null;
  private cursorInit: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private polling = false;
  private failures = 0;
  private closed = false;

  constructor(
    private readonly request: CrdtRequest,
    private readonly opts: ApiCrdtTransportOptions = {}
  ) {
    if (opts.scope && opts.vaultId) {
      throw new Error("a changes feed is scoped to one vault or to the shared documents, not both");
    }
    this.store = {
      load: (docId) => this.load(docId),
      save: (docId, snapshot) => this.save(docId, snapshot),
    };
    this.pubsub = {
      publish: () => {
        // Nothing to do: the save carries the edit to the server, and the
        // server broadcasts it to the live channel. A client on the API has no
        // channel of its own to put a delta on.
      },
      subscribe: (docId, onUpdate) => this.subscribe(docId, onUpdate),
    };
  }

  /** Stop polling. Subscriptions are forgotten; nothing is written. */
  close(): void {
    this.closed = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.subs.clear();
  }

  private async load(docId: string): Promise<Uint8Array | null> {
    // The cursor must predate the snapshot, or a change that lands between the
    // two is one this client never hears of.
    if (!this.opts.perDoc) await this.ensureCursor();
    const body = await retryingDb(
      `loading the snapshot for ${docId}`,
      async () =>
        asDbResult<CrdtSnapshotResponse>(await this.request(`/api/v1/docs/${docId}/crdt`)),
      this.opts.onRetry
    );
    this.versions.set(docId, body.version);
    return body.state ? base64ToBytes(body.state) : null;
  }

  private async save(docId: string, snapshot: Uint8Array): Promise<void> {
    const body = await retryingDb(
      `saving the snapshot for ${docId}`,
      async () =>
        asDbResult<{ version: number }>(
          await this.request(`/api/v1/docs/${docId}/crdt`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ state: bytesToBase64(snapshot) }),
          })
        ),
      this.opts.onRetry
    );
    this.note(docId, body.version);
  }

  private note(docId: string, version: number): void {
    if (version > (this.versions.get(docId) ?? -1)) this.versions.set(docId, version);
  }

  private subscribe(docId: string, onUpdate: (update: Uint8Array) => void): () => void {
    let set = this.subs.get(docId);
    if (!set) this.subs.set(docId, (set = new Set()));
    set.add(onUpdate);
    this.schedule(this.opts.pollMs ?? CRDT_POLL_MS);
    return () => {
      const s = this.subs.get(docId);
      if (!s) return;
      s.delete(onUpdate);
      if (s.size === 0) this.subs.delete(docId);
      if (this.subs.size === 0 && this.timer !== null) {
        clearTimeout(this.timer);
        this.timer = null;
      }
    };
  }

  private schedule(delayMs: number): void {
    if (this.closed || this.timer !== null || this.subs.size === 0) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.poll();
    }, delayMs);
  }

  /**
   * The first ask establishes WHERE "since" starts — the server's clock, not
   * ours — and reports nothing. Done once, before the first load, and shared by
   * every load that overlaps it.
   */
  private ensureCursor(): Promise<void> {
    if (this.cursor !== null) return Promise.resolve();
    if (!this.cursorInit) {
      this.cursorInit = retryingDb(
        "starting the change feed",
        async () => asDbResult<CrdtChangesResponse>(await this.request(this.changesPath(null))),
        this.opts.onRetry
      ).then(
        (body) => {
          this.cursor = body.cursor;
        },
        (e) => {
          this.cursorInit = null; // next load tries again
          throw e;
        }
      );
    }
    return this.cursorInit;
  }

  private changesPath(since: string | null): string {
    const params = new URLSearchParams();
    if (since) params.set("since", since);
    if (this.opts.scope === "shared") params.set("scope", "shared");
    else if (this.opts.vaultId) params.set("vault", this.opts.vaultId);
    const qs = params.toString();
    return `/api/v1/docs/crdt/changes${qs ? `?${qs}` : ""}`;
  }

  /** Ask now rather than at the next tick. Exposed for tests and for a host
   *  that knows something moved. */
  async poll(): Promise<void> {
    if (this.closed || this.polling) return;
    this.polling = true;
    let ok = true;
    try {
      if (this.opts.perDoc) await this.pollEach();
      else await this.pollChanges();
    } catch (e) {
      ok = false;
      this.opts.log?.(`poll failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      this.polling = false;
    }
    this.failures = ok ? 0 : this.failures + 1;
    const base = this.opts.pollMs ?? CRDT_POLL_MS;
    this.schedule(this.failures === 0 ? base : backoff(base, this.failures));
  }

  private async pollChanges(): Promise<void> {
    await this.ensureCursor();
    const res = await this.request(this.changesPath(this.cursor));
    const body = (await asDbResult<CrdtChangesResponse>(res));
    if (body.error) throw new Error(body.error.message);
    this.cursor = body.data.cursor;
    for (const change of body.data.changes) {
      if (!this.subs.has(change.doc_id)) continue;
      if (change.version <= (this.versions.get(change.doc_id) ?? -1)) continue;
      await this.fetchAndDeliver(change.doc_id);
    }
  }

  private async pollEach(): Promise<void> {
    for (const docId of [...this.subs.keys()]) {
      await this.fetchAndDeliver(docId, this.versions.get(docId));
    }
  }

  /** Fetch a document's snapshot and hand it to its subscribers as an update. */
  private async fetchAndDeliver(docId: string, after?: number): Promise<void> {
    const path =
      after === undefined
        ? `/api/v1/docs/${docId}/crdt`
        : `/api/v1/docs/${docId}/crdt?after=${after}`;
    const res = await asDbResult<CrdtSnapshotResponse>(await this.request(path));
    if (res.error) throw new Error(res.error.message);
    const body = res.data;
    if (body.unchanged || !body.state) return;
    if (body.version <= (this.versions.get(docId) ?? -1)) return;
    this.note(docId, body.version);
    const update = base64ToBytes(body.state);
    for (const cb of this.subs.get(docId) ?? []) cb(update);
  }
}

/** Double the wait per consecutive failure, capped, with a little jitter. */
function backoff(baseMs: number, failures: number): number {
  const ceiling = Math.min(CRDT_POLL_MAX_MS, baseMs * 2 ** Math.min(failures, 10));
  return Math.max(baseMs, Math.round(ceiling / 2 + (Math.random() * ceiling) / 2));
}

/** A request function for a caller holding an API key: the daemon, the desktop. */
export function bearerCrdtRequest(
  appUrl: string,
  apiKey: () => string | null,
  fetchImpl: (url: string, init: RequestInit) => Promise<Response> = (url, init) => fetch(url, init)
): CrdtRequest {
  const base = appUrl.replace(/\/$/, "");
  return (path, init = {}) => {
    const headers: Record<string, string> = { ...(init.headers ?? {}) };
    const key = apiKey();
    if (key) headers.Authorization = `Bearer ${key}`;
    return fetchImpl(`${base}${path}`, { method: init.method, headers, body: init.body });
  };
}
