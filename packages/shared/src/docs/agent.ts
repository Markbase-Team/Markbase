import { Node, Slice } from "prosemirror-model";
import { Transform } from "prosemirror-transform";
import type * as Y from "yjs";
import { docSchema } from "./schema";
import { markdownToDoc, docJsonToMarkdown } from "./markdown";
import { resolveQuoteToRange } from "./anchors";
import { offsetForQuote } from "./doc-comments";
import { applySteps } from "./steps";
import { derivedDoc, getMarkdown, setMarkdown, type Origin } from "./crdt";
import type { DocJSON, StepJSON } from "./types";

// Agent edit path. An agent thinks in text, not positions: it says "replace the
// text matching `quote` with `insert`". We resolve the quote to a range and
// build steps — a real, targeted operation, NOT a whole-document diff. Both
// humans (editor steps) and agents (this) feed the same authority.
//
// `insert` is parsed as markdown and its structure is preserved: inline markup
// (**bold**, `[link](url)`) merges into the target block; block markup
// (headings, lists, multiple paragraphs) is inserted as real nodes. To grow a
// doc, quote an anchor and repeat it at the start of `insert` — the repeated
// block merges into the target and the rest lands as new blocks after it.

export type AnchoredEdit = { quote: string; insert: string };

export function anchoredEditToSteps(
  docJson: DocJSON,
  edit: AnchoredEdit
): StepJSON[] {
  const range = resolveQuoteToRange(docJson, edit.quote);
  if (!range) {
    throw new Error(`Anchor not found: ${JSON.stringify(edit.quote)}`);
  }

  const doc = Node.fromJSON(docSchema, docJson);
  const slice = buildInsertSlice(edit.insert);

  // replaceRange fits the slice into the range — computing open depths, merging
  // compatible blocks at the edges, and splitting when block content lands
  // inside a text block. This is the same machinery the editor uses for paste.
  const tr = new Transform(doc);
  tr.replaceRange(range.from, range.to, slice);
  if (edit.insert.trim() && tr.steps.length === 0) {
    throw new Error("Could not build a replacement for the selection");
  }
  return tr.steps.map((s) => s.toJSON() as StepJSON);
}

/** Which route an anchored edit took. "source" touched only the quoted bytes. */
export type AnchoredEditPath = "source" | "derived";

/**
 * Apply an anchored edit to a document's CRDT, changing as little as possible.
 *
 * The steps above are already surgical, but applying them means deriving the
 * ProseMirror doc and serializing the RESULT back to markdown — which rewrites
 * the whole document from structure. That normalizes markdown the edit never
 * named: bold and code marks inside table cells vanish, hard-wrapped paragraphs
 * collapse into one line, table separators are rewritten. It is the
 * serialize-from-structure failure mode that crdt.ts says the Y.Text-is-truth
 * design exists to avoid, and it flattened a real document's tables in
 * production when an agent removed a single line from it.
 *
 * So try the markdown SOURCE first. When the quote is found there, splice the
 * insert into those bytes and let applyFastDiff carry exactly that span into the
 * Y.Text — everything the edit didn't name is untouched by construction rather
 * than by luck. Most quotes resolve here, including words wrapped in inline
 * markup, because the plain word still occurs inside the marks.
 *
 * A quote that exists only in the RENDERED text — one spanning a hard wrap or a
 * block boundary, where the projection shows a space the source spells as a
 * newline — cannot be located in the source, and falls back to the old path.
 * That case is still lossy; it is the narrower half, not the common one.
 *
 * Throws "Anchor not found" when the quote resolves in neither, which the edits
 * route turns into a 422.
 */
export function applyAnchoredEdit(
  doc: Y.Doc,
  edit: AnchoredEdit,
  origin: Origin = null
): AnchoredEditPath {
  const source = getMarkdown(doc);
  // offsetForQuote rejects an empty quote, so that falls through to the derived
  // path and throws there rather than editing at offset zero.
  const span = offsetForQuote(source, edit.quote);
  if (span) {
    setMarkdown(doc, source.slice(0, span.from) + edit.insert + source.slice(span.to), origin);
    return "source";
  }

  const docJson = derivedDoc(doc);
  const steps = anchoredEditToSteps(docJson, edit); // throws when unresolvable
  setMarkdown(doc, docJsonToMarkdown(applySteps(docJson, steps)), origin);
  return "derived";
}

// Turn the markdown `insert` into a slice that preserves its structure.
function buildInsertSlice(insert: string): Slice {
  if (!insert.trim()) return Slice.empty;
  const snippet = markdownToDoc(insert);
  // A single paragraph = inline content (formatted or plain). Insert its inline
  // fragment so marks survive and it merges into the target block rather than
  // forcing a new paragraph.
  if (
    snippet.childCount === 1 &&
    snippet.firstChild?.type.name === "paragraph"
  ) {
    return new Slice(snippet.firstChild.content, 0, 0);
  }
  // Block-level markdown (headings, lists, multiple blocks) — insert the whole
  // structure; replaceRange fits/splits it into place.
  return new Slice(snippet.content, 0, 0);
}
