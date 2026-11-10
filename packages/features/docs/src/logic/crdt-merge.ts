// Merging a saved snapshot with an incoming one, on the server.
//
// A snapshot save used to be an upsert: the row became whatever the last client
// sent. Two clients hold two replicas, and a replica that has not yet received
// the other's latest edits — a daemon between polls, a browser whose socket
// dropped — would overwrite the stored copy with a state that lacked them. The
// edits still lived in the other client's memory, but if that client never
// saved again they were gone from the cloud.
//
// Yjs makes the fix cheap: two states of one document merge into one state
// containing every edit of both, with no conflict and no doc to build.
// `Y.mergeUpdates` works on the encoded form, so this never instantiates a
// Y.Doc — which matters, because it runs on every save of every client.
//
// Pure, so the server's compare-and-swap loop (crdt-store.ts) can retry it on a
// lost race without a network in sight, and so it is unit-testable here.

import * as Y from "yjs";

export interface MergedSnapshot {
  /** Everything the stored state had, plus everything the incoming one adds. */
  state: Uint8Array;
  /**
   * What the incoming state added relative to the stored one — the update a
   * live peer needs to catch up. Null when nothing was added.
   */
  delta: Uint8Array | null;
  /** False when the stored state already contained the incoming one. */
  changed: boolean;
}

/**
 * Merge `incoming` into `existing`.
 *
 * Throws on bytes that are not a Yjs update, which a handler turns into a 400:
 * a corrupt snapshot must never be stored, because every client restores from
 * it.
 */
export function mergeSnapshot(existing: Uint8Array | null, incoming: Uint8Array): MergedSnapshot {
  // Decoding is the validation: garbage throws here rather than later, inside
  // mergeUpdates, with a less useful message.
  Y.decodeUpdate(incoming);
  if (existing === null) {
    return { state: incoming, delta: incoming, changed: true };
  }
  const state = Y.mergeUpdates([existing, incoming]);
  // Re-encoded the same way the merged state was, so the two are comparable
  // byte for byte: a merge that added nothing yields the identical encoding.
  if (bytesEqual(state, Y.mergeUpdates([existing]))) {
    return { state: existing, delta: null, changed: false };
  }
  const delta = Y.diffUpdate(state, Y.encodeStateVectorFromUpdate(existing));
  return { state, delta, changed: true };
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
