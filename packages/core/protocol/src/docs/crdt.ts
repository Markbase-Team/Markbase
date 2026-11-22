// Y.Text-is-truth CRDT bridge.
//
// The raw markdown is stored VERBATIM in a Y.Text (the source of truth); the
// rich structure is only ever DERIVED from it for the editor, never serialized
// back for storage. That single choice eliminates the whole class of round-trip
// fidelity bugs (images, blockquotes, frontmatter drift) that afflict a
// serialize-markdown-from-structure model — the markdown is never regenerated,
// so it cannot be lost.
//
// This is a clean reimplementation of the architecture proven by OpenKnowledge
// (GPL v3): the approach and the well-known algorithms (a DMP character diff
// applied to a Y.Text; line-based diff3), written fresh here, not copied.

import * as Y from "yjs";
import { diff3Merge } from "node-diff3";
import { markdownToDoc } from "./markdown";
import type { DocJSON } from "./types";

/** Origin tag passed through Yjs transactions (identity matters for undo). */
export type Origin = object | string | null;

// The Y.Text key holding the raw markdown — the document's source of truth.
const SOURCE_KEY = "source";

function sourceText(doc: Y.Doc): Y.Text {
  return doc.getText(SOURCE_KEY);
}

const isHigh = (c: number): boolean => c >= 0xd800 && c <= 0xdbff;
const isLow = (c: number): boolean => c >= 0xdc00 && c <= 0xdfff;

/**
 * Mutate `ytext` so it equals `next`, replacing only the differing middle span
 * and leaving the common prefix + suffix untouched — so their CRDT identity
 * survives and a concurrent edit elsewhere merges cleanly instead of clobbering.
 *
 * Boundaries are snapped to code-point edges: Yjs stores a Y.Text as items and
 * CANNOT split a surrogate pair across an item boundary, so a delete/insert that
 * landed mid-pair (e.g. swapping 😀→😢, which share a high surrogate) would
 * corrupt the text into lone surrogates. Backing the prefix/suffix off any split
 * pair guarantees every delete/insert operates on whole code points.
 */
export function applyFastDiff(ytext: Y.Text, current: string, next: string): void {
  if (current === next) return;

  const maxPre = Math.min(current.length, next.length);
  let pre = 0;
  while (pre < maxPre && current.charCodeAt(pre) === next.charCodeAt(pre)) pre++;
  // Don't end the prefix between a high surrogate and its low half.
  if (pre > 0 && pre < current.length && isLow(current.charCodeAt(pre)) && isHigh(current.charCodeAt(pre - 1))) {
    pre--;
  }

  const maxSuf = Math.min(current.length - pre, next.length - pre);
  let suf = 0;
  while (suf < maxSuf && current.charCodeAt(current.length - 1 - suf) === next.charCodeAt(next.length - 1 - suf)) suf++;
  // Don't start the suffix between a high surrogate and its low half.
  const sufStart = current.length - suf;
  if (suf > 0 && sufStart > 0 && isLow(current.charCodeAt(sufStart)) && isHigh(current.charCodeAt(sufStart - 1))) {
    suf--;
  }

  const delLen = current.length - pre - suf;
  const insStr = next.slice(pre, next.length - suf);
  if (delLen > 0) ytext.delete(pre, delLen);
  if (insStr) ytext.insert(pre, insStr);
}

/** A Y.Doc seeded with markdown as its source of truth. */
export function createDoc(markdown = ""): Y.Doc {
  const doc = new Y.Doc();
  if (markdown) sourceText(doc).insert(0, markdown);
  return doc;
}

/** The document's markdown, verbatim. This is the source of truth. */
export function getMarkdown(doc: Y.Doc): string {
  return sourceText(doc).toString();
}

/**
 * Absorb a new full-markdown state (an agent/vim/editor file write) as a minimal
 * character diff into the Y.Text, atomically. This is the markdown → CRDT path.
 */
export function setMarkdown(doc: Y.Doc, next: string, origin: Origin = null): void {
  const ytext = sourceText(doc);
  doc.transact(() => {
    applyFastDiff(ytext, ytext.toString(), next);
  }, origin);
}

/**
 * The derived rich structure for the editor view. It is allowed to be lossy —
 * it never feeds back into storage. `getMarkdown` stays verbatim regardless,
 * which is the whole point of the Y.Text-is-truth contract.
 */
export function derivedDoc(doc: Y.Doc): DocJSON {
  return markdownToDoc(getMarkdown(doc)).toJSON() as DocJSON;
}

/**
 * Observe changes to the source markdown. The callback receives the originating
 * transaction's origin, so a caller can ignore edits it made itself (the
 * editor-binding loop guard). Returns an unsubscribe function.
 */
export function observeMarkdown(doc: Y.Doc, cb: (origin: Origin) => void): () => void {
  const text = sourceText(doc);
  const handler = (_e: Y.YTextEvent, txn: Y.Transaction): void => cb(txn.origin as Origin);
  text.observe(handler);
  return () => text.unobserve(handler);
}

// --- Sync primitives (Yjs binary update deltas) ---

export function encodeUpdate(doc: Y.Doc): Uint8Array {
  return Y.encodeStateAsUpdate(doc);
}

export function applyUpdate(doc: Y.Doc, update: Uint8Array, origin: Origin = null): void {
  Y.applyUpdate(doc, update, origin);
}

// --- Three-way merge (reconcile long-divergent offline streams) ---

interface Diff3Ok {
  ok: string[];
}
interface Diff3Conflict {
  conflict: { a: string[]; aIndex: number; o: string[]; oIndex: number; b: string[]; bIndex: number };
}
type Diff3Region = Diff3Ok | Diff3Conflict;

export interface MergeResult {
  text: string;
  conflict: boolean;
}

/**
 * Line-based three-way merge of markdown. Non-overlapping edits from both sides
 * are both kept; genuinely overlapping regions are emitted with git-style
 * markers and `conflict: true`. Reimplements OK's `mergeThreeWay` via diff3.
 */
export function threeWayMerge(base: string, ours: string, theirs: string): MergeResult {
  if (base === ours) return { text: theirs, conflict: false };
  if (base === theirs) return { text: ours, conflict: false };
  if (ours === theirs) return { text: ours, conflict: false };

  const regions = diff3Merge(ours.split("\n"), base.split("\n"), theirs.split("\n")) as Diff3Region[];
  const out: string[] = [];
  let conflict = false;
  for (const region of regions) {
    if ("ok" in region) {
      out.push(region.ok.join("\n"));
    } else {
      conflict = true;
      out.push(
        "<<<<<<< ours",
        region.conflict.a.join("\n"),
        "=======",
        region.conflict.b.join("\n"),
        ">>>>>>> theirs"
      );
    }
  }
  return { text: out.join("\n"), conflict };
}
