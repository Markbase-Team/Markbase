import { describe, it, expect } from "vitest";
import { markdownToDoc } from "../src/logic/markdown";
import { docText, posToTextOffset, textOffsetToPos } from "../src/logic/anchors";

// The ProseMirror-position ↔ text-offset bridge that carries a caret through a
// remote content swap (roadmap B5). The pure offset math lives in selection.ts;
// these pin the conversion to real ProseMirror positions, including the block
// separator convention (a space between blocks) that docText/charPositions use.

describe("posToTextOffset ↔ textOffsetToPos", () => {
  it("round-trips every caret position in a single paragraph", () => {
    const doc = markdownToDoc("hello world\n");
    const text = docText(doc);
    expect(text).toBe("hello world");
    // Walk every text offset; pos→offset→pos must be stable.
    for (let off = 0; off <= text.length; off++) {
      const pos = textOffsetToPos(doc, off);
      expect(posToTextOffset(doc, pos)).toBe(off);
    }
  });

  it("treats a block boundary as one separator character", () => {
    const doc = markdownToDoc("first\n\nsecond\n");
    // Two paragraphs render as "first second" — a single separator between them.
    expect(docText(doc)).toBe("first second");
  });

  it("maps a caret in the SECOND block to the right offset", () => {
    const doc = markdownToDoc("first\n\nsecond\n");
    const text = docText(doc);
    const offOfSecondS = text.indexOf("second"); // 6 (after "first ")
    const pos = textOffsetToPos(doc, offOfSecondS);
    // Round-trips, and lands on the "s" of "second".
    expect(posToTextOffset(doc, pos)).toBe(offOfSecondS);
    expect(text[offOfSecondS]).toBe("s");
  });

  it("clamps an offset past the end to a valid caret at the doc end", () => {
    const doc = markdownToDoc("abc\n");
    const pos = textOffsetToPos(doc, 999);
    // A valid position (setTextSelection would accept it) at/just past the last char.
    expect(pos).toBeGreaterThan(0);
    expect(posToTextOffset(doc, pos)).toBe(docText(doc).length);
  });

  it("collapses an empty document to the start", () => {
    const doc = markdownToDoc("");
    expect(docText(doc)).toBe("");
    expect(textOffsetToPos(doc, 0)).toBe(0);
    expect(textOffsetToPos(doc, 5)).toBe(0);
  });
});
