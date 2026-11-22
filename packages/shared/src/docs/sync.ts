// Cloud-sync data layer for the CRDT (roadmap F1, cloud half — data model).
//
// Thin, tested primitives over Yjs that the transport (Supabase Realtime + a
// persistence table) will call. Kept separate from the transport so the sync
// PROTOCOL is unit-testable without a network or a DB:
//
//   - snapshot / restore     — persist a doc to bytes and rebuild it
//   - stateVector / diffSince — request and compute a MINIMAL delta for a peer
//   - mergeUpdates           — compact an append-only update log into one blob
//   - applyRemote            — merge an incoming delta
//
// Everything is a binary Yjs update, so the transport just moves bytes.

import * as Y from "yjs";

/** Full document state as bytes, for persistence (a DB row / object). */
export function snapshot(doc: Y.Doc): Uint8Array {
  return Y.encodeStateAsUpdate(doc);
}

/** Rebuild a doc from a persisted snapshot. */
export function restore(bytes: Uint8Array): Y.Doc {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, bytes);
  return doc;
}

/** A doc's state vector — what a peer sends to request only what it's missing. */
export function stateVector(doc: Y.Doc): Uint8Array {
  return Y.encodeStateVector(doc);
}

/** The minimal update that brings a peer at `remoteStateVector` up to date. */
export function diffSince(doc: Y.Doc, remoteStateVector: Uint8Array): Uint8Array {
  return Y.encodeStateAsUpdate(doc, remoteStateVector);
}

/** Compact an append-only log of updates into a single equivalent update. */
export function mergeUpdates(updates: Uint8Array[]): Uint8Array {
  return Y.mergeUpdates(updates);
}

/** Merge an incoming delta into a doc. */
export function applyRemote(doc: Y.Doc, update: Uint8Array): void {
  Y.applyUpdate(doc, update);
}
