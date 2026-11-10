import type { Doc as YDoc } from "yjs";
import {
  createDoc,
  derivedDoc,
  getMarkdown,
  restore,
  snapshot,
  type DocJSON,
} from "@markbase/docs";
import { mirrorDocContent } from "@markbase/docs/server";
import { broadcastCrdt, loadCrdtSnapshot, saveCrdtSnapshot } from "./crdt-store";

// The external agent HTTP API edits the SAME CRDT Y.Doc the browser editor and
// the vault daemon sync — so agent edits and human edits converge (roadmap F1).
// These helpers open a document's CRDT server-side: they load the `doc_crdt`
// snapshot, seeding an in-memory Y.Doc from the row's markdown when the cloud is
// still empty (a doc created via `POST /docs` has a row but no snapshot yet —
// the same rule the browser and VaultSync use). Reads derive from the CRDT;
// writes persist a MERGED snapshot (so a concurrent human edit is never
// clobbered), nudge live clients, and mirror the new markdown to Postgres.

/**
 * Open the doc's CRDT, run `fn` against it, and close — read-only. No snapshot is
 * written, so an unseeded doc is simply derived from `seedMarkdown` (its row
 * content); the first WRITE is what seeds the cloud CRDT.
 */
export async function readDocCrdt<T>(
  docId: string,
  seedMarkdown: string,
  fn: (doc: YDoc) => T
): Promise<T> {
  const existing = await loadCrdtSnapshot(docId);
  const doc = existing ? restore(existing.state) : createDoc(seedMarkdown);
  try {
    return fn(doc);
  } finally {
    doc.destroy();
  }
}

export type EditResult<T> = { result: T; markdown: string; docJson: DocJSON };

/**
 * Open the doc's CRDT, run `fn` (which MUTATES the Y.Doc — e.g. `setMarkdown`,
 * `checkpoint`, `restoreVersion`), then persist and broadcast.
 *
 * The save is a merge with a compare-and-swap (crdt-store.ts), so anything
 * persisted since we opened — a human edit that landed mid-request — is kept,
 * and two edits racing each other both land. The Realtime broadcast is
 * best-effort; live clients also reconcile from the snapshot on their next
 * load, so a missed broadcast only delays convergence, never loses the edit.
 */
export async function editDocCrdt<T>(
  docId: string,
  seedMarkdown: string,
  fn: (doc: YDoc) => T
): Promise<EditResult<T>> {
  const existing = await loadCrdtSnapshot(docId);
  const doc = existing ? restore(existing.state) : createDoc(seedMarkdown);
  try {
    const result = fn(doc);
    const saved = await saveCrdtSnapshot(docId, snapshot(doc));
    // Awaited: this runs in a request handler on a serverless runtime, and a
    // function that returns while the broadcast is still in flight may be
    // frozen before it leaves. Never rejects — publish reports its own
    // failures — so the edit, already saved, is answered either way. The whole
    // merged state goes out, not just the delta: a peer that missed an earlier
    // broadcast catches up from this one.
    if (saved.changed) await broadcastCrdt(docId, saved.state);
    const markdown = getMarkdown(doc);
    const docJson = derivedDoc(doc);
    // Keep the Postgres row in step so full-text search + the doc list reflect
    // the edit (the CRDT is the truth; this is a searchable mirror).
    await mirrorDocContent(docId, markdown, docJson);
    return { result, markdown, docJson };
  } finally {
    doc.destroy();
  }
}
