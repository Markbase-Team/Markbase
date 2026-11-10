import { Node } from "prosemirror-model";
import { docSchema } from "./schema";
import { mapPositionThroughSteps } from "./steps";
import type { Anchor, DocJSON, StepJSON } from "./types";

// Comment anchoring. An anchor is a ProseMirror position range plus the text it
// was pinned to. When the document changes, we map the range forward through the
// applied steps (deterministic, not fuzzy) — see remapAnchor. resolveQuoteToRange
// turns an agent's / reviewer's quoted text into a position range against the
// current document.

// Build a flat string of the document's text with a single space at each block
// boundary — mirroring how the editor captures a selection with
// `doc.textBetween(from, to, " ")` — while recording the ProseMirror position of
// every real character. A positional gap between consecutive text nodes means we
// crossed a block boundary, so we emit the separator there.
type CharPos = { ch: string; pos: number };

function charPositions(doc: Node): CharPos[] {
  const chars: CharPos[] = [];
  let prevEnd = -1;
  doc.descendants((node, pos) => {
    if (node.isText && node.text) {
      if (prevEnd >= 0 && pos > prevEnd) chars.push({ ch: " ", pos: prevEnd });
      const text = node.text;
      for (let i = 0; i < text.length; i++) {
        chars.push({ ch: text[i]!, pos: pos + i });
      }
      prevEnd = pos + text.length;
    }
    return true;
  });
  return chars;
}

/**
 * Locate `quote` in the document's text and return its position range — using
 * the same block-separator convention the editor uses to capture selections, so
 * cross-block quotes resolve. Returns null when the quote isn't found (e.g. the
 * block was rewritten) — the caller treats that as an outdated/orphaned anchor.
 */
export function resolveQuoteToRange(
  docJson: DocJSON,
  quote: string
): Anchor | null {
  if (!quote) return null;
  const doc = Node.fromJSON(docSchema, docJson);
  const chars = charPositions(doc);
  const fullText = chars.map((c) => c.ch).join("");
  const index = fullText.indexOf(quote);
  if (index === -1) return null;
  const startChar = chars[index];
  const endChar = chars[index + quote.length - 1];
  if (!startChar || !endChar) return null;
  return { from: startChar.pos, to: endChar.pos + 1, quote };
}

/**
 * The document's flat text — the same block-separated projection anchors resolve
 * against. This is the coordinate the selection-preservation math (roadmap B5)
 * runs in: capture the caret as an offset here, map it through the text change,
 * turn it back into a position.
 */
export function docText(doc: Node): string {
  return charPositions(doc).map((c) => c.ch).join("");
}

/**
 * Text offset (into `docText`) for a ProseMirror position — where the caret sits
 * in the flat text. The caret sits BEFORE the first character at or after `pos`,
 * so we return that character's index; a caret past the last character maps to the
 * text length.
 */
export function posToTextOffset(doc: Node, pos: number): number {
  const chars = charPositions(doc);
  for (let i = 0; i < chars.length; i++) {
    if (chars[i]!.pos >= pos) return i;
  }
  return chars.length;
}

/**
 * Inverse of `posToTextOffset`: a ProseMirror position for a text offset, clamped
 * to the document. An offset at or past the end lands just after the last
 * character (a valid caret position); an empty doc collapses to the start.
 */
export function textOffsetToPos(doc: Node, offset: number): number {
  const chars = charPositions(doc);
  if (chars.length === 0) return 0;
  if (offset <= 0) return chars[0]!.pos;
  if (offset >= chars.length) {
    const last = chars[chars.length - 1]!;
    return last.pos + 1;
  }
  return chars[offset]!.pos;
}

/**
 * Move an anchor forward across applied steps. If its start and end collapse to
 * the same point, the anchored text was deleted — the caller marks the comment
 * outdated and falls back to the stored quote.
 */
export function remapAnchor(
  anchor: Anchor,
  steps: StepJSON[]
): { anchor: Anchor; outdated: boolean } {
  const from = mapPositionThroughSteps(anchor.from, steps, 1);
  const to = mapPositionThroughSteps(anchor.to, steps, -1);
  const outdated = to <= from;
  return { anchor: { ...anchor, from, to: Math.max(from, to) }, outdated };
}
