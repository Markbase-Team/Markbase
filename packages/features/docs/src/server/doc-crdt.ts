import type { Doc as YDoc } from "yjs";
import {
  addApiRead,
  checkpoint,
  createDoc,
  derivedDoc,
  getMarkdown,
  restore,
  snapshot,
  versionCount,
  type DocJSON,
  type VersionCredit,
} from "@markbase/protocol/docs";
import type { Actor } from "./auth";
import { mirrorDocContent } from "./documents";
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

/** Who is writing through the seam, and what to call the version they leave. */
export interface Writer {
  actor: Actor;
  /** A name for the version in history ("Created", "Restored version 3"). */
  label?: string;
}

/**
 * Who a version written through the API is credited to. An agent's edit is
 * credited as an agent's ("Jessie's Claude"), so history and line credit
 * show it as one; a person's edit, to the person.
 */
export function versionCredit(actor: Actor): VersionCredit {
  if (actor.kind !== "agent") return { author: actor.name };
  // Whose agent and which tool, apart — the shape an agent's hook records, so
  // "Jessie's Claude" is one writer however the edit arrived. An agent that
  // did not say which tool it is, is "agent".
  if (actor.agent) return { author: actor.agent.owner, agents: [actor.agent.tool ?? "agent"] };
  return { agents: [actor.name] };
}

/**
 * Open the doc's CRDT, run `fn` (which MUTATES the Y.Doc — e.g. `setMarkdown`,
 * `restoreVersion`), record what it changed as a version in `by`'s name, then
 * persist and broadcast.
 *
 * The version is cut HERE, not by the caller. Every content change the API
 * makes passes through this function, so this is the one place that can
 * promise none goes unrecorded — and a handler that forgets is a handler that
 * credits the next viewer's idle ticker with an agent's work (that is how a
 * document Codex created came to read as the person's). A caller may still
 * record earlier inside `fn` when it needs the version's index; the seam then
 * finds nothing new to say. What gets a version: a change `fn` made, or the
 * first write to a document that has none — creation is a write of nothing
 * onto the seed, and the seed is the creator's.
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
  by: Writer,
  fn: (doc: YDoc) => T
): Promise<EditResult<T>> {
  const existing = await loadCrdtSnapshot(docId);
  const doc = existing ? restore(existing.state) : createDoc(seedMarkdown);
  try {
    const before = getMarkdown(doc);
    const result = fn(doc);
    if (versionCount(doc) === 0 || getMarkdown(doc) !== before) {
      checkpoint(doc, { ...versionCredit(by.actor), ...(by.label === undefined ? {} : { label: by.label }) });
    }
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

/**
 * The reader an API read is counted for: an agent whose tool is known, on its
 * owner's behalf — the same `{ agent, owner }` its file hooks record, so a
 * read over MCP and a read of the file land in one row. Null for everyone
 * else: a person in a browser is not an agent, and a key that says no tool
 * (the desktop app's own, reading for its window) is not an agent reading.
 */
export function apiReader(actor: Actor): { agent: string; owner: string } | null {
  if (actor.kind !== "agent" || !actor.agent?.tool) return null;
  return { agent: actor.agent.tool, owner: actor.agent.owner };
}

/**
 * Count one read of the document by an agent that read it through the API
 * (an MCP tool, `markbase api`), in the tally the Analytics panel shows.
 *
 * Only a document that already has a CRDT: one that has none has never been
 * opened anywhere, and creating it just to hold a read would cut its first
 * version in the reader's name. Never cuts a version; a read inside the
 * repeat window changes nothing and writes nothing. Never throws — a read is
 * answered whether or not it could be counted.
 */
export async function countApiRead(docId: string, actor: Actor, now: number = Date.now()): Promise<boolean> {
  const reader = apiReader(actor);
  if (!reader) return false;
  try {
    const existing = await loadCrdtSnapshot(docId);
    if (!existing) return false;
    const doc = restore(existing.state);
    try {
      if (!addApiRead(doc, reader, now)) return false;
      const saved = await saveCrdtSnapshot(docId, snapshot(doc));
      // Awaited for the same reason as an edit's: a serverless function may be
      // frozen once it answers. The panel of anyone looking hears the new count.
      if (saved.changed) await broadcastCrdt(docId, saved.state);
      return saved.changed;
    } finally {
      doc.destroy();
    }
  } catch {
    // Counting is advisory; the read already succeeded.
    return false;
  }
}
