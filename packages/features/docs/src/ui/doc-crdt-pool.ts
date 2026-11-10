// A warm pool of open CRDT documents, keyed by docId — the engine behind
// instant tab switching.
//
// Opening a doc means loading its snapshot through the API and subscribing to
// its Realtime channel; that's the expensive part, and we do NOT want to redo it
// every time you flip between open tabs. So the pool keeps each opened doc's
// `Y.Doc` + live `SyncSession` + `Y.UndoManager` alive after the editor unbinds,
// and hands the same one back when you return. An editor (see useCrdtSync)
// `acquire`s a doc when it mounts and `release`s it when it unmounts; the pool
// closes a doc only once it's been idle (refCount 0) and pushed out by the LRU
// cap, so a handful of recently-open docs stay warm and switching to them is a
// rebind, not a reload.
//
// The UndoManager lives HERE, on the doc — not on the editor — so a doc's
// undo/redo stack survives the editor unbinding and rebinding (roadmap B5): flip
// to another tab and back, and ⌘Z still walks your edits. It tracks the "editor"
// origin only, so undo reverts your own edits and leaves remote/file edits put.

import type * as Y from "yjs";
import {
  openEditorDoc,
  createUndoManager,
  type DocStore,
  type DocPubSub,
} from "@markbase/docs";
import { SupabaseDocPubSub } from "@markbase/docs/crdt-supabase";
import { ApiCrdtTransport, type CrdtRequest } from "@markbase/docs/crdt-api";
import { createSupabaseBrowserClient } from "@markbase/protocol/browser";
import { api } from "@markbase/protocol/api-client";
import { desktopTransport } from "./ipc-crdt";
import { isLocalDocId, LocalFileSession } from "./local-file-crdt";
import type { CrdtPort, DocsPorts, LocalFilePort } from "./ports";

/**
 * What keeps a pooled Y.Doc in step with its backing: a SyncSession for a cloud
 * document, a LocalFileSession for a file on disk. The pool needs only this of
 * either; a surface that needs the file's state checks which it has.
 */
export interface DocSession {
  /** Write anything a debounce is holding. */
  flush(): void;
  /** Stop syncing. Anything pending is written first. */
  close(): void;
}

export type CrdtEntry = {
  doc: Y.Doc;
  session: DocSession;
  /** Per-doc undo, tracking the "editor" origin. Survives editor rebinds. */
  undo: Y.UndoManager;
};

type Slot = {
  refCount: number;
  lastUsed: number;
  /** Resolves once the snapshot has loaded and the session is live. */
  opening: Promise<CrdtEntry>;
  /** Set once `opening` resolves, so eviction can close it synchronously. */
  entry: CrdtEntry | null;
  /** Set when the slot has been evicted while still opening, so the open path
   *  closes it as soon as it resolves instead of leaking a live session. */
  evicted: boolean;
};

// How many IDLE (refCount 0) docs to keep warm before evicting the
// least-recently-used. Docs with an editor bound (refCount > 0) are never
// evicted regardless. Small enough to bound memory + live channels, large
// enough that flipping among your open tabs is always a warm rebind.
const WARM_CAP = 8;

type Transport = { store: DocStore; pubsub: DocPubSub };

/**
 * How this tab reaches a document's state: as the signed-in user (a cookie the
 * browser attaches), or as a share-link guest carrying a token. One answer per
 * tab — a guest page is its own page — set by DocClientProvider before any
 * editor mounts, read when the first cloud document opens.
 */
interface DocAccess {
  shareToken: string | null;
}
let access: DocAccess = { shareToken: null };

/** Tell the pool it is serving a share-link guest. Idempotent. */
export function setDocCrdtAccess(next: DocAccess): void {
  access = next;
}

/** The API, with the guest's token when there is one. */
const crdtRequest: CrdtRequest = (path, init = {}) => {
  const headers = new Headers(init.headers);
  if (access.shareToken) headers.set("X-Share-Token", access.shareToken);
  return api.request(path, { method: init.method, headers, body: init.body });
};

class DocCrdtPool {
  private readonly slots = new Map<string, Slot>();
  private cloudTransport: Transport | null = null;

  /**
   * What the host offers to back documents with: snapshots served locally
   * (desktop), and the file a window was opened on (the desktop's file
   * window). Either may be null; a browser has neither.
   */
  constructor(
    private readonly crdt: CrdtPort | null,
    private readonly localFile: LocalFilePort | null
  ) {}

  // Which transport the sync engine gets.
  //
  // On the desktop the main process serves snapshots from disk, so opening a
  // document costs a message between processes instead of a round trip to the
  // cloud, and pushes down what its poll of the API finds. In a browser the
  // snapshot comes from the API (security lockdown stage 2: nothing in a page
  // touches the database), and live deltas travel on a private Realtime channel
  // the signed-in session may join. A share-link guest has no session to join
  // with, so it polls its one document through the API instead.
  //
  // Built on the first CLOUD document, not when the pool is made: the Supabase
  // client reads its URL and key from the page's build, and a window with no
  // cloud in it — the desktop's file window, which only ever opens local ids —
  // has neither. Making it eagerly would throw before any document opened.
  private get transport(): Transport {
    if (!this.cloudTransport) {
      if (this.crdt) {
        this.cloudTransport = desktopTransport(this.crdt);
      } else if (access.shareToken) {
        this.cloudTransport = new ApiCrdtTransport(crdtRequest, { perDoc: true });
      } else {
        this.cloudTransport = {
          store: new ApiCrdtTransport(crdtRequest).store,
          pubsub: new SupabaseDocPubSub(createSupabaseBrowserClient()) as DocPubSub,
        };
      }
    }
    return this.cloudTransport;
  }

  /** Snapshots fetched ahead of an open — see `prefetch`. */
  private readonly warm = new Map<string, Promise<Uint8Array | null>>();

  /**
   * Start fetching a document's snapshot before anything opens it.
   *
   * Opening a document used to fetch this only once the editor had mounted,
   * which happens after the API call that the editor's content does not depend
   * on — so the one request carrying the actual document waited behind an
   * unrelated one. Calling this when the document is chosen puts them side by
   * side.
   *
   * It deliberately does NOT open the document: no Y.Doc, no session, and above
   * all no seeding. `openEditorDoc` treats "no snapshot" as "seed from the
   * caller's markdown and save it", and at this point we have no markdown to
   * seed with — opening early would persist an empty CRDT over a document whose
   * content lives in its row.
   */
  prefetch(docId: string): void {
    if (isLocalDocId(docId)) return; // the file is already in hand
    if (this.slots.has(docId) || this.warm.has(docId)) return;
    const p = this.transport.store.load(docId);
    // Someone may never consume this (the user moves on); keep a failure from
    // surfacing as an unhandled rejection. `take` re-reads on a rejected warm.
    p.catch(() => {});
    this.warm.set(docId, p);
  }

  /**
   * The store `openEditorDoc` sees: a warm snapshot answers the first `load`,
   * otherwise it goes to the network.
   *
   * A warm entry that REJECTED falls through to a fresh load rather than being
   * reported as null — "we couldn't reach the server" and "this document has no
   * snapshot" must never be confused, because the second one seeds and saves.
   */
  private takeStore(): DocStore {
    const warm = this.warm;
    const store = this.transport.store;
    return {
      load: async (id: string): Promise<Uint8Array | null> => {
        const pending = warm.get(id);
        warm.delete(id);
        if (pending) {
          try {
            return await pending;
          } catch {
            // fall through — ask again, and let a real failure propagate
          }
        }
        return store.load(id);
      },
      save: (id: string, snapshot: Uint8Array): Promise<void> => store.save(id, snapshot),
    };
  }

  /**
   * Open a document on whatever backs it.
   *
   * A local id (`local:<path>`) is a file on disk in the desktop's file window:
   * the Y.Doc is seeded from the markdown handed in, which IS the file, and the
   * session writes it back. No transport is touched — not the store, not the
   * pub/sub — so such a window never reaches the network at all. Opening one
   * where there is nothing to write to is reported, not worked around: the
   * surface shows the error.
   */
  private open(docId: string, initialMarkdown: string): Promise<{ doc: Y.Doc; session: DocSession }> {
    if (isLocalDocId(docId)) {
      if (!this.localFile) {
        return Promise.reject(new Error("This window has no file to save to."));
      }
      const session = new LocalFileSession(this.localFile, initialMarkdown);
      return Promise.resolve({ doc: session.doc, session });
    }
    return openEditorDoc(docId, initialMarkdown, this.takeStore(), this.transport.pubsub);
  }

  /**
   * Get the warm entry for `docId`, opening it if needed, and mark it in use.
   * `initialMarkdown` seeds the CRDT only when the cloud has none yet (first
   * open); afterwards the cloud is the truth and it's ignored. Every acquire
   * must be paired with a `release`.
   */
  acquire(docId: string, initialMarkdown: string): Promise<CrdtEntry> {
    let slot = this.slots.get(docId);
    if (!slot) {
      const created: Slot = {
        refCount: 0,
        lastUsed: Date.now(),
        entry: null,
        evicted: false,
        opening: this.open(docId, initialMarkdown).then(
          (opened) => {
            const entry: CrdtEntry = {
              doc: opened.doc,
              session: opened.session,
              undo: createUndoManager(opened.doc, ["editor"]),
            };
            // If we were evicted mid-open, don't leak the session — close now.
            if (created.evicted) {
              closeEntry(entry);
            } else {
              created.entry = entry;
            }
            return entry;
          },
          (err) => {
            // Open failed (e.g. network): forget the slot so a remount retries
            // instead of every acquire getting this same cached rejection.
            this.slots.delete(docId);
            throw err;
          }
        ),
      };
      slot = created;
      this.slots.set(docId, slot);
    }
    slot.refCount++;
    slot.lastUsed = Date.now();
    slot.evicted = false;
    return slot.opening;
  }

  /**
   * The already-open entry for `docId`, or null if nothing has opened it.
   *
   * For readers that want the document but must never CREATE it — comments and
   * version history are stored inside the same Y.Doc the editor is bound to, so
   * they should read that one rather than open a second replica. Opening is left
   * to the editor because only the editor knows the seed markdown; joining
   * without it would risk seeding an empty CRDT over a document whose content
   * still lives in its row.
   */
  join(docId: string): Promise<CrdtEntry> | null {
    const slot = this.slots.get(docId);
    if (!slot) return null;
    slot.refCount++;
    slot.lastUsed = Date.now();
    slot.evicted = false;
    return slot.opening;
  }

  /** Release one use of `docId`. The doc stays warm until the LRU evicts it. */
  release(docId: string): void {
    const slot = this.slots.get(docId);
    if (!slot) return;
    slot.refCount = Math.max(0, slot.refCount - 1);
    slot.lastUsed = Date.now();
    this.evict();
  }

  /** Close and forget the oldest idle docs beyond the warm cap. */
  private evict(): void {
    const idle = [...this.slots.entries()].filter(([, s]) => s.refCount === 0);
    if (idle.length <= WARM_CAP) return;
    idle.sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    for (const [id, s] of idle.slice(0, idle.length - WARM_CAP)) {
      this.slots.delete(id);
      s.evicted = true;
      if (s.entry) closeEntry(s.entry);
      // If still opening, the open path closes it once `evicted` is seen.
    }
  }
}

function closeEntry(entry: CrdtEntry): void {
  try {
    entry.undo.destroy();
  } catch {
    // best effort
  }
  try {
    entry.session.close();
  } catch {
    // best effort
  }
  try {
    entry.doc.destroy();
  } catch {
    // best effort
  }
}

let pool: DocCrdtPool | null = null;

/**
 * The one warm CRDT pool for this tab, on the backings the host offers.
 *
 * Created lazily on first use (client), and the first caller's ports are the
 * ones it keeps: a window has one shell, so every caller is handing in the same
 * object — the pool is a singleton precisely so that every editor in the window
 * shares one open document, and a second pool on other backings would be a
 * second replica of every document.
 */
export function docCrdtPool(ports: DocsPorts): DocCrdtPool {
  if (!pool) pool = new DocCrdtPool(ports.crdt, ports.localFile);
  return pool;
}
