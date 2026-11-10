import { randomUUID } from "node:crypto";
import { Node } from "prosemirror-model";
import { supabase } from "@markbase/protocol/supabase";
import { docSchema } from "../logic/schema";
import { applySteps } from "../logic/steps";
import { docToMarkdown, deriveTitle, isUntitled, markdownToDoc } from "../logic/markdown";
import { diffCounts, diffSegments, type DiffSegment } from "../logic/diff";
import { docReplaceSteps } from "../logic/restore";
import type { Author, DocJSON, StepJSON } from "../logic/types";
import { getDocument } from "./documents";

// The collab authority. Every edit — human or agent — flows through receiveSteps.
// Concurrency is serialize-first via an atomic compare-and-set on the document's
// version: the conditional UPDATE only matches when the version hasn't moved, so
// two racing submits can't both win. (Full rebase/merge is a later phase.)

const db = () => supabase.schema("docs");

export type ReceiveResult =
  | { ok: true; version: number }
  | { ok: false; conflict: true; serverVersion: number };

export async function receiveSteps(input: {
  docId: string;
  clientVersion: number;
  steps: StepJSON[];
  author: Author;
  // The editing session this save belongs to (a "version" in history). Omitted
  // by server-initiated edits (agent edits, restores) — each gets its own.
  sessionId?: string;
}): Promise<ReceiveResult> {
  const { docId, clientVersion, steps, author } = input;
  if (steps.length === 0) {
    const doc = await getDocument(docId);
    if (!doc) throw new Error("Document not found");
    return { ok: true, version: doc.version };
  }

  const doc = await getDocument(docId);
  if (!doc) throw new Error("Document not found");
  if (clientVersion !== doc.version) {
    return { ok: false, conflict: true, serverVersion: doc.version };
  }

  // Apply on top of the version the client based its steps on.
  const newDocJson = applySteps(doc.doc_json, steps);
  const content = docToMarkdown(Node.fromJSON(docSchema, newDocJson));
  const newVersion = doc.version + steps.length;
  // Semantic magnitude of this save: words changed in the markdown.
  const { added, removed } = diffCounts(doc.content, content);

  // Name the document only if it has no name yet. Every save used to re-derive the
  // title from the markdown and write it back, so an agent editing the BODY of a
  // titled document could silently rename it — and because the path follows the
  // title, rename its file too. A document that is already named keeps its name
  // until someone renames it on purpose.
  const title = isUntitled(doc.title) ? deriveTitle(content) : null;

  // Compare-and-set: only commit if nobody advanced the version meanwhile.
  const cas = await db()
    .from("documents")
    .update({
      doc_json: newDocJson,
      content,
      version: newVersion,
      updated_at: new Date().toISOString(),
      ...(title ? { title } : {}),
    })
    .eq("id", docId)
    .eq("version", clientVersion)
    .select("version")
    .maybeSingle();
  if (cas.error) throw cas.error;
  if (!cas.data) {
    const latest = await getDocument(docId);
    return { ok: false, conflict: true, serverVersion: latest?.version ?? doc.version };
  }

  // Append ONE batch row for this save — the whole submission, not one row per
  // step. The version range (from..to) preserves the per-step counter collab
  // needs, while the durable record stays per-save.
  const ins = await db().from("steps").insert({
    doc_id: docId,
    from_version: clientVersion,
    to_version: newVersion,
    steps,
    added,
    removed,
    session_id: input.sessionId ?? randomUUID(),
    author_kind: author.kind,
    author_id: author.id ?? null,
    author_name: author.name,
  });
  if (ins.error) throw ins.error;

  return { ok: true, version: newVersion };
}

// A revision = one save: an author's batch of steps over a version range, with
// the words added/removed (the semantic magnitude).
export interface RevisionRow {
  from_version: number;
  to_version: number;
  session_id: string | null;
  author_kind: string;
  author_id: string | null;
  author_name: string;
  created_at: string;
  added: number;
  removed: number;
}

// Reconstruct the ProseMirror document at a version boundary by replaying steps
// from the immutable v0 snapshot (base_doc). Steps up to `version` = batches
// with to_version <= version; version boundaries always align to batch ends.
export async function docJsonAtVersion(
  docId: string,
  version: number
): Promise<DocJSON> {
  const doc = await getDocument(docId);
  if (!doc) throw new Error("Document not found");
  const base = doc.base_doc ?? doc.doc_json;
  if (version <= 0) return base;
  const { data, error } = await db()
    .from("steps")
    .select("steps, to_version")
    .eq("doc_id", docId)
    .lte("to_version", version)
    .order("from_version", { ascending: true });
  if (error) throw error;
  const flat: StepJSON[] = [];
  for (const row of data ?? []) {
    const batch = (row as { steps: StepJSON[] }).steps;
    if (Array.isArray(batch)) flat.push(...batch);
  }
  return applySteps(base, flat);
}

/** The reconstructed markdown at a version boundary. */
export async function contentAtVersion(
  docId: string,
  version: number
): Promise<string> {
  const json = await docJsonAtVersion(docId, version);
  return docToMarkdown(Node.fromJSON(docSchema, json));
}


/**
 * Save whole-document markdown as an edit on top of `baseVersion` — the write
 * half of the local folder mirror, and any other "here is the new text" client.
 *
 * `docReplaceSteps` narrows the change to the span that actually differs, so an
 * untouched paragraph produces no step and comment anchors past the edit remap
 * instead of being orphaned. Passing the caller's `baseVersion` (not head) is
 * what makes a concurrent browser edit surface as a conflict rather than being
 * quietly overwritten.
 */
export async function setDocContent(input: {
  docId: string;
  markdown: string;
  baseVersion: number;
  author: Author;
}): Promise<ReceiveResult> {
  const doc = await getDocument(input.docId);
  if (!doc) throw new Error("Document not found");
  if (input.baseVersion !== doc.version) {
    return { ok: false, conflict: true, serverVersion: doc.version };
  }
  const targetJson = markdownToDoc(input.markdown).toJSON() as DocJSON;
  const steps = docReplaceSteps(doc.doc_json, targetJson);
  return receiveSteps({
    docId: input.docId,
    clientVersion: input.baseVersion,
    steps,
    author: input.author,
  });
}

/** Restore a past version as a new edit on top of head (append-only history). */
export async function restoreVersion(
  docId: string,
  version: number,
  author: Author
): Promise<ReceiveResult> {
  const doc = await getDocument(docId);
  if (!doc) throw new Error("Document not found");
  const targetJson = await docJsonAtVersion(docId, version);
  const steps = docReplaceSteps(doc.doc_json, targetJson);
  return receiveSteps({ docId, clientVersion: doc.version, steps, author });
}

/** Inline word-diff of a revision range: markdown at `fromVersion` vs `toVersion`. */
export async function revisionDiff(
  docId: string,
  fromVersion: number,
  toVersion: number
): Promise<DiffSegment[]> {
  const [before, after] = await Promise.all([
    contentAtVersion(docId, fromVersion),
    contentAtVersion(docId, toVersion),
  ]);
  return diffSegments(before, after);
}

/** The saves on a doc, oldest first — the history timeline. */
export async function listRevisions(docId: string): Promise<RevisionRow[]> {
  const { data, error } = await db()
    .from("steps")
    .select(
      "from_version, to_version, session_id, author_kind, author_id, author_name, created_at, added, removed"
    )
    .eq("doc_id", docId)
    .order("from_version", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => {
    const row = r as {
      from_version: number;
      to_version: number;
      session_id: string | null;
      author_kind: string;
      author_id: string | null;
      author_name: string;
      created_at: string;
      added: number;
      removed: number;
    };
    return {
      from_version: row.from_version,
      to_version: row.to_version,
      session_id: row.session_id ?? null,
      author_kind: row.author_kind,
      author_id: row.author_id ?? null,
      author_name: row.author_name,
      created_at: row.created_at,
      added: row.added ?? 0,
      removed: row.removed ?? 0,
    };
  });
}
