import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { createDoc, setMarkdown } from "../src/logic/crdt";
import { createAnchor, resolveAnchor, type CrdtAnchor } from "../src/logic/anchor";

// Anchors bind a comment/suggestion to a span of the markdown source using Yjs
// relative positions, which survive concurrent edits and converge — the CRDT
// answer to comment anchoring (vs op-log remapping). "orphaned" = the anchored
// text was deleted.

const src = (doc: Y.Doc) => doc.getText("source");

describe("anchor: basic resolution", () => {
  it("resolves to the span it was created over", () => {
    const doc = createDoc("The quick brown fox.\n");
    const a = createAnchor(doc, 4, 9); // "quick"
    const r = resolveAnchor(doc, a);
    expect(r).not.toBeNull();
    expect(src(doc).toString().slice(r!.from, r!.to)).toBe("quick");
    expect(a.quote).toBe("quick");
  });

  it("serializes to plain JSON and back", () => {
    const doc = createDoc("hello world\n");
    const a = createAnchor(doc, 0, 5); // "hello"
    const round = JSON.parse(JSON.stringify(a)) as CrdtAnchor;
    const r = resolveAnchor(doc, round);
    expect(src(doc).toString().slice(r!.from, r!.to)).toBe("hello");
  });
});

describe("anchor: survives edits", () => {
  it("shifts with an insertion before it", () => {
    const doc = createDoc("The quick brown fox.\n");
    const a = createAnchor(doc, 4, 9); // "quick"
    setMarkdown(doc, "Well, the quick brown fox.\n"); // inserted text before "quick"
    const r = resolveAnchor(doc, a);
    expect(r).not.toBeNull();
    expect(src(doc).toString().slice(r!.from, r!.to)).toBe("quick");
  });

  it("is unaffected by an edit after it", () => {
    const doc = createDoc("alpha beta gamma\n");
    const a = createAnchor(doc, 0, 5); // "alpha"
    setMarkdown(doc, "alpha beta gamma delta epsilon\n");
    const r = resolveAnchor(doc, a);
    expect(src(doc).toString().slice(r!.from, r!.to)).toBe("alpha");
  });

  it("survives concurrent edits and converges on both clients", () => {
    const a = createDoc("one two three four\n");
    const b = createDoc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    const anchor = createAnchor(a, 8, 13); // "three"
    const sa = Y.encodeStateVector(a), sb = Y.encodeStateVector(b);
    setMarkdown(a, "ONE one two three four\n");   // edit before the anchor on A
    setMarkdown(b, "one two three four FIVE six\n"); // edit after the anchor on B
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b, sa));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a, sb));
    const ra = resolveAnchor(a, anchor);
    const rb = resolveAnchor(b, anchor);
    expect(a.getText("source").toString().slice(ra!.from, ra!.to)).toBe("three");
    expect(b.getText("source").toString().slice(rb!.from, rb!.to)).toBe("three");
  });
});

describe("anchor: orphaning", () => {
  it("orphans (null) when its span is deleted", () => {
    const doc = createDoc("keep DELETEME keep\n");
    const a = createAnchor(doc, 5, 13); // "DELETEME"
    setMarkdown(doc, "keep  keep\n"); // removed the anchored word
    const r = resolveAnchor(doc, a);
    // With both ends collapsed onto the same point and the text gone, the anchor
    // is empty/degenerate — treated as orphaned.
    expect(r === null || r.from === r.to).toBe(true);
  });
});
