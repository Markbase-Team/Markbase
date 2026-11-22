// Cloud transport coordinator (roadmap F1, cloud half — the sync lifecycle).
//
// Binds a Y.Doc to a persistence store and a pub/sub channel: hydrates from the
// saved snapshot, applies remote updates, publishes + persists local edits. The
// store and pub/sub are injected, so the lifecycle is unit-testable with no
// network or DB; the real Supabase adapter (a snapshot table + a Realtime
// channel) implements these two interfaces and is thin glue.
//
// Both interfaces are ASYNC because a real backend is — the browser editor and
// the worker both `await SyncSession.open(...)`, which loads before wiring up.
//
// Echo guard: updates that arrive from the bus (origin "remote") or the persisted
// snapshot (origin "persist") are applied but never re-published, so a change
// can't loop between clients.

import * as Y from "yjs";
import { snapshot } from "./sync";
import type { Origin } from "./crdt";

/** Persisted document state, keyed by document id. */
export interface DocStore {
  load(docId: string): Promise<Uint8Array | null>;
  save(docId: string, snapshot: Uint8Array): Promise<void>;
}

/** A pub/sub channel carrying binary Yjs updates, keyed by document id. */
export interface DocPubSub {
  /**
   * Send an update to every other subscriber. Settles once the send has been
   * handed off (or has failed, which the implementation reports) — so a caller
   * that must not return before the broadcast has left, such as a request
   * handler on a serverless runtime, can await it. One that must not wait,
   * such as the editor on each keystroke, lets it go. Never rejects: a failed
   * broadcast is a missed keystroke for other clients, reconciled on their next
   * sync, and is logged, not thrown.
   */
  publish(docId: string, update: Uint8Array): void | Promise<void>;
  subscribe(docId: string, onUpdate: (update: Uint8Array) => void): () => void;
}

const REMOTE: Origin = "remote";
const PERSIST: Origin = "persist";

/**
 * How long to wait for typing to pause before writing the snapshot, and the
 * longest a stream of edits may defer it.
 *
 * A snapshot is the WHOLE document, and a Y.Doc emits an update per transaction —
 * so saving on every update meant typing uploaded the entire document, over and
 * over, from whichever peer you were typing in. The delta still goes out
 * immediately (it is tiny, and it is what other peers need to stay live); only
 * the durable copy waits.
 *
 * The cap matters as much as the pause: without it, someone typing steadily for
 * a minute would never persist at all.
 */
const SAVE_QUIET_MS = 800;
const SAVE_MAX_WAIT_MS = 5_000;

export class SyncSession {
  private constructor(
    readonly docId: string,
    readonly doc: Y.Doc,
    private readonly unsubscribe: () => void,
    /** Write any snapshot still waiting on the debounce below. */
    private readonly flushSave: () => void
  ) {}

  /**
   * Open a synced session: hydrate from the store (or seed it so a later joiner
   * shares our causal base), subscribe for remote updates, and publish + persist
   * local edits.
   *
   * `loaded` lets a caller that has ALREADY read the snapshot hand it over
   * instead of making us fetch it again — openEditorDoc reads it to decide
   * whether to seed, and that was costing every doc open a second round trip for
   * bytes it already had. `undefined` means "not loaded"; `null` means "loaded,
   * and the cloud is empty".
   */
  static async open(
    docId: string,
    doc: Y.Doc,
    store: DocStore,
    pubsub: DocPubSub,
    loaded?: Uint8Array | null
  ): Promise<SyncSession> {
    const persisted = loaded === undefined ? await store.load(docId) : loaded;
    if (persisted) Y.applyUpdate(doc, persisted, PERSIST);
    else await store.save(docId, snapshot(doc));

    const unsubscribe = pubsub.subscribe(docId, (update) => {
      Y.applyUpdate(doc, update, REMOTE);
    });

    // The snapshot is taken when the save FIRES, not when it is scheduled, so a
    // deferred write still carries everything typed since.
    let saveTimer: ReturnType<typeof setTimeout> | null = null;
    let pendingSince = 0;

    const flushSave = (): void => {
      if (saveTimer !== null) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      if (pendingSince === 0) return; // nothing waiting
      pendingSince = 0;
      void store.save(docId, snapshot(doc)); // fire-and-forget persist
    };

    const scheduleSave = (): void => {
      const now = Date.now();
      if (pendingSince === 0) pendingSince = now;
      if (now - pendingSince >= SAVE_MAX_WAIT_MS) {
        flushSave(); // held off long enough — write it even mid-sentence
        return;
      }
      if (saveTimer !== null) clearTimeout(saveTimer);
      saveTimer = setTimeout(flushSave, SAVE_QUIET_MS);
    };

    doc.on("update", (update: Uint8Array, origin: Origin) => {
      if (origin === REMOTE || origin === PERSIST) return;
      // Live, immediately: it is a few bytes. Not awaited — this is a keystroke,
      // and the implementation reports its own failures.
      void pubsub.publish(docId, update);
      scheduleSave(); // durable, shortly: it is the whole document
    });

    return new SyncSession(docId, doc, unsubscribe, flushSave);
  }

  /**
   * Write a pending snapshot now instead of waiting out the debounce.
   *
   * For changes that aren't typing and shouldn't be coalesced with it — the
   * open-time reconcile between a vault file and the cloud, say, which has to be
   * durable before anything else looks at the store.
   */
  flush(): void {
    this.flushSave();
  }

  /** Stop syncing. Anything the debounce was holding is written first. */
  close(): void {
    this.flushSave();
    this.unsubscribe();
  }
}
