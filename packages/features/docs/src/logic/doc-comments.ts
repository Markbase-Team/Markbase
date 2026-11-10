// Comments in the CRDT (roadmap B1).
//
// Comments live in a Y.Array in the SAME Y.Doc as the content — so they sync over
// the one `crdt:<docId>` channel, travel in the sidecar for offline/file-drive
// users, and, by anchoring on Yjs RELATIVE positions (CrdtAnchor), stay on their
// text through any edit. The old system pinned a comment to a quoted string and
// re-found it by search, which broke on duplicates and drifted under edits.
//
// Each comment is a Y.Map, not a frozen object: unlike append-only versions,
// comments MUTATE (resolve, and threading references them), and a Y.Map lets two
// devices edit the same comment's fields and converge. A thread is a root comment
// (with an anchor) plus replies (parentId → root, no anchor of their own).

import * as Y from "yjs";
import { createAnchor, resolveAnchor, isOrphaned, type CrdtAnchor } from "./anchor";
import { resolveQuoteToRange } from "./anchors";
import type { DocJSON } from "./types";

const COMMENTS_KEY = "comments";

/** A comment's stored fields. Kept to primitives + the anchor so a Y.Map holds it. */
type CommentValue = string | number | boolean | CrdtAnchor | null;

/** What a rendered thread carries — the root plus its replies, anchor resolved. */
export interface CommentView {
  id: string;
  parentId: string | null;
  body: string;
  authorName: string;
  authorId: string | null;
  at: number;
  resolved: boolean;
  /** Current text at the anchor, or the stored quote when orphaned. Roots only. */
  quote: string;
  /** Markdown-source offsets now, or null for a reply or an orphaned root. */
  range: { from: number; to: number } | null;
  orphaned: boolean;
  replies: CommentView[];
}

function log(doc: Y.Doc): Y.Array<Y.Map<CommentValue>> {
  return doc.getArray<Y.Map<CommentValue>>(COMMENTS_KEY);
}

/** Typed field reads — Y.Map.get returns the value union, so narrow deliberately. */
function str(m: Y.Map<CommentValue>, k: string): string {
  const v = m.get(k);
  return typeof v === "string" ? v : "";
}
function strOrNull(m: Y.Map<CommentValue>, k: string): string | null {
  const v = m.get(k);
  return typeof v === "string" ? v : null;
}
function num(m: Y.Map<CommentValue>, k: string): number {
  const v = m.get(k);
  return typeof v === "number" ? v : 0;
}
function bool(m: Y.Map<CommentValue>, k: string): boolean {
  return m.get(k) === true;
}
function anchorOf(m: Y.Map<CommentValue>): CrdtAnchor | null {
  const v = m.get("anchor");
  // The anchor is the one non-primitive value; identify it by shape.
  return v && typeof v === "object" && "from" in v && "to" in v ? (v as CrdtAnchor) : null;
}

function newId(): string {
  return crypto.randomUUID();
}

function find(doc: Y.Doc, id: string): { map: Y.Map<CommentValue>; index: number } | null {
  const arr = log(doc);
  for (let i = 0; i < arr.length; i++) {
    if (str(arr.get(i), "id") === id) return { map: arr.get(i), index: i };
  }
  return null;
}

/** One raw comment as stored — root or reply, before threading/resolving. */
interface RawComment {
  id: string;
  parentId: string | null;
  body: string;
  authorName: string;
  authorId: string | null;
  at: number;
  resolved: boolean;
  anchor: CrdtAnchor | null;
}

function read(doc: Y.Doc): RawComment[] {
  return log(doc)
    .toArray()
    .map((m) => ({
      id: str(m, "id"),
      parentId: strOrNull(m, "parentId"),
      body: str(m, "body"),
      authorName: str(m, "authorName"),
      authorId: strOrNull(m, "authorId"),
      at: num(m, "at"),
      resolved: bool(m, "resolved"),
      anchor: anchorOf(m),
    }));
}

/** Anchor a NEW comment over `[from, to)` of the markdown source and store it. */
export function addComment(
  doc: Y.Doc,
  input: {
    from: number;
    to: number;
    body: string;
    author: { name: string; id?: string | null };
    id?: string;
    at?: number;
  }
): { id: string } {
  const m = new Y.Map<CommentValue>();
  const id = input.id ?? newId();
  m.set("id", id);
  m.set("parentId", null);
  m.set("anchor", createAnchor(doc, input.from, input.to));
  m.set("body", input.body);
  m.set("authorName", input.author.name);
  m.set("authorId", input.author.id ?? null);
  m.set("resolved", false);
  m.set("at", input.at ?? Date.now());
  log(doc).push([m]);
  return { id };
}

/** Add a reply under a thread's root. Replies carry no anchor of their own. */
export function addReply(
  doc: Y.Doc,
  input: {
    parentId: string;
    body: string;
    author: { name: string; id?: string | null };
    id?: string;
    at?: number;
  }
): { id: string } {
  const m = new Y.Map<CommentValue>();
  const id = input.id ?? newId();
  m.set("id", id);
  m.set("parentId", input.parentId);
  m.set("anchor", null);
  m.set("body", input.body);
  m.set("authorName", input.author.name);
  m.set("authorId", input.author.id ?? null);
  m.set("resolved", false);
  m.set("at", input.at ?? Date.now());
  log(doc).push([m]);
  return { id };
}

/** Mark a thread resolved/unresolved by its root id. */
export function resolveComment(doc: Y.Doc, rootId: string, resolved: boolean): void {
  find(doc, rootId)?.map.set("resolved", resolved);
}

/** Remove a comment — and, if it's a root, its replies with it. */
export function deleteComment(doc: Y.Doc, id: string): void {
  const arr = log(doc);
  // Back to front so indices stay valid as we delete.
  for (let i = arr.length - 1; i >= 0; i--) {
    const m = arr.get(i);
    if (str(m, "id") === id || strOrNull(m, "parentId") === id) arr.delete(i, 1);
  }
}

/**
 * Every top-level thread, oldest first, with its anchor resolved to current
 * offsets and its replies nested. An orphaned root (its text was deleted) keeps
 * its stored quote and reports `range: null`.
 */
export function listCommentThreads(doc: Y.Doc): CommentView[] {
  const raw = read(doc);
  const repliesByParent = new Map<string, RawComment[]>();
  for (const c of raw) {
    if (c.parentId) {
      const list = repliesByParent.get(c.parentId) ?? [];
      list.push(c);
      repliesByParent.set(c.parentId, list);
    }
  }

  const view = (c: RawComment): CommentView => {
    const resolved = c.anchor ? resolveAnchor(doc, c.anchor) : null;
    const orphaned = c.anchor !== null && isOrphaned(resolved);
    const range = c.anchor && resolved && !orphaned ? resolved : null;
    const quote = range ? doc.getText("source").toString().slice(range.from, range.to) : c.anchor?.quote ?? "";
    return {
      id: c.id,
      parentId: c.parentId,
      body: c.body,
      authorName: c.authorName,
      authorId: c.authorId,
      at: c.at,
      resolved: c.resolved,
      quote,
      range,
      orphaned,
      replies: (repliesByParent.get(c.id) ?? [])
        .sort((x, y) => x.at - y.at)
        .map(view),
    };
  };

  return raw
    .filter((c) => c.parentId === null)
    .sort((x, y) => x.at - y.at)
    .map(view);
}

/** Ranges the editor should highlight: unresolved, non-orphaned roots. */
export function commentRanges(doc: Y.Doc): Array<{ from: number; to: number; id: string }> {
  return listCommentThreads(doc)
    .filter((t) => !t.resolved && t.range !== null)
    .map((t) => ({ from: t.range!.from, to: t.range!.to, id: t.id }));
}

/**
 * Where a selected quote sits in the markdown source, so a comment can be anchored
 * there. The editor gives us the selected TEXT, not a source offset — this bridges
 * the two.
 *
 * A quote can occur more than once; `hint` (an approximate source offset from the
 * selection) disambiguates by picking the nearest occurrence, so commenting on the
 * second "the" doesn't anchor the first. Without a hint, the first occurrence.
 * Returns null when the quote isn't in the source (a stale selection).
 */
/**
 * The editor position ranges to highlight for a set of threads.
 *
 * Extracted from the editor so the actual logic — skip resolved/orphaned/quoteless
 * threads, resolve each live quote to a range in the CURRENT document — is unit
 * tested, not just eyeballed. The editor is then a thin caller: threads in, ranges
 * onto the highlight plugin.
 */
export function commentHighlightRanges(
  threads: CommentView[],
  docJson: DocJSON
): Array<{ from: number; to: number }> {
  const ranges: Array<{ from: number; to: number }> = [];
  for (const t of threads) {
    if (t.resolved || t.orphaned || !t.quote) continue;
    const anchor = resolveQuoteToRange(docJson, t.quote);
    if (anchor) ranges.push({ from: anchor.from, to: anchor.to });
  }
  return ranges;
}

/**
 * Watch a document's comments and call `onThreads` with the current threads now and
 * on every change. observeDeep, because a resolve is a field edit INSIDE an item
 * that a shallow observe would miss. Returns a detach.
 *
 * Extracted from useCrdtSync so the observe→emit wiring is testable against a real
 * Y.Doc, with no React.
 */
export function watchComments(doc: Y.Doc, onThreads: (threads: CommentView[]) => void): () => void {
  const arr = log(doc);
  const emit = (): void => onThreads(listCommentThreads(doc));
  arr.observeDeep(emit);
  emit();
  return () => arr.unobserveDeep(emit);
}

export function offsetForQuote(
  source: string,
  quote: string,
  hint?: number
): { from: number; to: number } | null {
  if (!quote) return null;
  const occurrences: number[] = [];
  for (let i = source.indexOf(quote); i !== -1; i = source.indexOf(quote, i + 1)) {
    occurrences.push(i);
  }
  if (occurrences.length === 0) return null;
  const from =
    hint === undefined
      ? occurrences[0]
      : occurrences.reduce((best, o) => (Math.abs(o - hint) < Math.abs(best - hint) ? o : best));
  return { from, to: from + quote.length };
}
