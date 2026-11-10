// CRDT anchoring for comments and suggestions.
//
// A comment or suggestion binds to a span of the markdown source. Storing raw
// character offsets would break the moment anyone edits earlier in the doc;
// instead we use Yjs relative positions, which travel with the content they
// point at and converge under concurrent edits — so an anchor stays on its text
// no matter who edits where. If the anchored text is deleted, the anchor
// collapses (from === to) and callers treat it as orphaned.
//
// This is the review-layer foundation: agent suggestions and human comments both
// anchor this way, and both survive edits to the surrounding document.

import * as Y from "yjs";

const SOURCE_KEY = "source";

/** A serializable anchor over a span of a document's markdown source. */
export interface CrdtAnchor {
  /** Encoded Yjs relative position of the span start (JSON-portable bytes). */
  from: number[];
  /** Encoded Yjs relative position of the span end. */
  to: number[];
  /** The anchored text at creation — human-readable, and a fallback for search. */
  quote: string;
}

/** Create an anchor over `[from, to)` in the document's markdown source. */
export function createAnchor(doc: Y.Doc, from: number, to: number): CrdtAnchor {
  const ytext = doc.getText(SOURCE_KEY);
  const relFrom = Y.createRelativePositionFromTypeIndex(ytext, from);
  const relTo = Y.createRelativePositionFromTypeIndex(ytext, to);
  return {
    from: Array.from(Y.encodeRelativePosition(relFrom)),
    to: Array.from(Y.encodeRelativePosition(relTo)),
    quote: ytext.toString().slice(from, to),
  };
}

/**
 * Resolve an anchor to current character offsets, or null if it can't be placed.
 * A degenerate span (from === to) is returned as-is; callers should treat that
 * as orphaned (its text was deleted).
 */
export function resolveAnchor(doc: Y.Doc, anchor: CrdtAnchor): { from: number; to: number } | null {
  const relFrom = Y.decodeRelativePosition(Uint8Array.from(anchor.from));
  const relTo = Y.decodeRelativePosition(Uint8Array.from(anchor.to));
  const absFrom = Y.createAbsolutePositionFromRelativePosition(relFrom, doc);
  const absTo = Y.createAbsolutePositionFromRelativePosition(relTo, doc);
  if (!absFrom || !absTo) return null;
  const from = Math.min(absFrom.index, absTo.index);
  const to = Math.max(absFrom.index, absTo.index);
  return { from, to };
}

/** Whether a resolved anchor still points at real text. */
export function isOrphaned(resolved: { from: number; to: number } | null): boolean {
  return resolved === null || resolved.from === resolved.to;
}
