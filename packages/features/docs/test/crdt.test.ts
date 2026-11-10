import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import {
  createDoc,
  getMarkdown,
  setMarkdown,
  applyFastDiff,
  derivedDoc,
  encodeUpdate,
  applyUpdate,
  threeWayMerge,
} from "../src/logic/crdt";
import { markdownToDoc, docToMarkdown } from "../src/logic/markdown";
import { docSchema } from "../src/logic/schema";
import { Node } from "prosemirror-model";

// The corpus that broke Markbase's serialize-from-structure path (BUG-1: images
// lost, BUG-2: blockquotes joined, BUG-3: frontmatter rewritten).
const CORPUS: Record<string, string> = {
  "standalone image": "![alt](image.png)\n",
  "image after text": "Here is text ![alt](image.png)\n",
  "link + image": "See [the link](https://example.com) and ![alt](image.png).\n",
  "multi blockquote": "> line one\n> line two\n",
  "frontmatter": "---\ntitle: Doc\ntags: [a, b]\n---\n\n# Body\n\ncontent\n",
  "table": "| A | B |\n| --- | --- |\n| 1 | 2 |\n",
  "emoji / astral": "# 🚀 Ship it\n\nCafé — 日本語 — 👨‍👩‍👧‍👦 family.\n",
  "mixed": "# Spec\n\n- **Goal** ![logo](l.png)\n\n> quote\n> more\n",
};

describe("Y.Text-is-truth: verbatim fidelity (fixes the fidelity bug class)", () => {
  for (const [name, md] of Object.entries(CORPUS)) {
    it(`round-trips ${name} verbatim`, () => {
      const doc = createDoc(md);
      expect(getMarkdown(doc)).toBe(md);
    });
  }

  it("survives an external re-write (setMarkdown) verbatim", () => {
    const doc = createDoc("# Old\n");
    for (const md of Object.values(CORPUS)) {
      setMarkdown(doc, md);
      expect(getMarkdown(doc)).toBe(md);
    }
  });

  it("keeps an image verbatim — and the structure path no longer drops it (B0)", () => {
    const md = "See [x](https://e.com) and ![alt](image.png).\n";
    // BUG-1 used to drop the image here (a block image couldn't sit in an
    // `inline*` paragraph, so ProseMirror discarded the paragraph's content).
    // Images are inline now, so the serialize-from-structure path round-trips.
    const viaStructure = docToMarkdown(Node.fromJSON(docSchema, markdownToDoc(md).toJSON()));
    expect(viaStructure).toContain("image.png");
    // Y.Text-is-truth is stronger still: byte-for-byte verbatim, always.
    expect(getMarkdown(createDoc(md))).toBe(md);
  });
});

describe("char-level diff minimality (unchanged content keeps CRDT identity)", () => {
  it("editing one word leaves an anchor on unchanged text valid", () => {
    const doc = createDoc("The quick brown fox jumps.\n");
    const ytext = doc.getText("source");
    // Anchor on 'fox' (index 16).
    const anchor = Y.createRelativePositionFromTypeIndex(ytext, 16);
    setMarkdown(doc, "The slow brown fox jumps.\n"); // change 'quick'->'slow' (before the anchor)
    const abs = Y.createAbsolutePositionFromRelativePosition(anchor, doc);
    expect(abs).not.toBeNull();
    // The anchor still points at the same character run ('fox' region).
    expect(getMarkdown(doc).slice(abs!.index, abs!.index + 3)).toBe("fox");
  });

  it("a no-op setMarkdown produces no change", () => {
    const doc = createDoc("stable content\n");
    const before = encodeUpdate(doc).length;
    setMarkdown(doc, "stable content\n");
    expect(getMarkdown(doc)).toBe("stable content\n");
    expect(encodeUpdate(doc).length).toBe(before);
  });
});

describe("convergence (offline-capable merge via Yjs updates)", () => {
  it("two docs with concurrent edits converge to identical markdown", () => {
    const base = "# Title\n\nAlpha.\n\nBeta.\n";
    const a = createDoc(base);
    const b = createDoc(base);
    // sync b from a so they share history
    applyUpdate(b, encodeUpdate(a));
    const sa = Y.encodeStateVector(a);
    const sb = Y.encodeStateVector(b);
    // concurrent edits: a edits the first para, b edits the second
    setMarkdown(a, "# Title\n\nAlpha edited by A.\n\nBeta.\n");
    setMarkdown(b, "# Title\n\nAlpha.\n\nBeta edited by B.\n");
    // exchange deltas
    applyUpdate(b, Y.encodeStateAsUpdate(a, sb));
    applyUpdate(a, Y.encodeStateAsUpdate(b, sa));
    expect(getMarkdown(a)).toBe(getMarkdown(b)); // converged
    expect(getMarkdown(a)).toContain("edited by A");
    expect(getMarkdown(a)).toContain("edited by B");
  });
});

describe("three-way merge", () => {
  it("merges non-overlapping edits with no conflict", () => {
    const base = "line1\nline2\nline3\n";
    const ours = "line1-mine\nline2\nline3\n";
    const theirs = "line1\nline2\nline3-theirs\n";
    const r = threeWayMerge(base, ours, theirs);
    expect(r.conflict).toBe(false);
    expect(r.text).toContain("line1-mine");
    expect(r.text).toContain("line3-theirs");
  });

  it("flags a genuine conflict on the same line", () => {
    const base = "shared line\n";
    const ours = "my version\n";
    const theirs = "their version\n";
    const r = threeWayMerge(base, ours, theirs);
    expect(r.conflict).toBe(true);
    expect(r.text).toContain("<<<<<<<");
  });

  it("fast-paths when only one side changed", () => {
    const base = "a\nb\n";
    expect(threeWayMerge(base, "a\nb\n", "a\nB\n")).toEqual({ text: "a\nB\n", conflict: false });
  });
});

describe("derived view is separate from the source of truth", () => {
  it("a lossy derived view does not corrupt the verbatim source", () => {
    const md = "text ![alt](image.png) more\n";
    const doc = createDoc(md);
    derivedDoc(doc); // may drop the image in the view — must not touch the source
    expect(getMarkdown(doc)).toBe(md);
  });
});

// --- Adversarial: the spots where a subtle bug would actually hide ---

describe("adversarial edge cases", () => {
  it("edits across a surrogate pair keep correct offsets (UTF-16 alignment)", () => {
    // 😀 is a surrogate pair (2 UTF-16 units). If DMP offsets and Y.Text
    // indexing disagree on units, the edit lands in the wrong place.
    const doc = createDoc("a😀b\n");
    setMarkdown(doc, "a😀ZZ\n"); // replace 'b' with 'ZZ', just past the emoji
    expect(getMarkdown(doc)).toBe("a😀ZZ\n");
    const doc2 = createDoc("start 👨‍👩‍👧‍👦 end\n"); // ZWJ family: many units
    setMarkdown(doc2, "START 👨‍👩‍👧‍👦 end\n");
    expect(getMarkdown(doc2)).toBe("START 👨‍👩‍👧‍👦 end\n");
    setMarkdown(doc2, "START 👨‍👩‍👧‍👦 END\n");
    expect(getMarkdown(doc2)).toBe("START 👨‍👩‍👧‍👦 END\n");
  });

  it("a one-character edit on a big doc produces a small delta, not a full replace", () => {
    const big = "paragraph number placeholder.\n".repeat(2000); // ~60KB
    const doc = createDoc(big);
    const sv = Y.encodeStateVector(doc);
    setMarkdown(doc, big + "x"); // append one char
    const delta = Y.encodeStateAsUpdate(doc, sv);
    // A minimal diff = a few bytes; a full-doc replace would be ~60KB.
    expect(delta.length).toBeLessThan(200);
    expect(getMarkdown(doc)).toBe(big + "x");
  });

  it("concurrent inserts at the SAME position converge without loss", () => {
    const a = createDoc("XY\n");
    const b = createDoc();
    applyUpdate(b, encodeUpdate(a));
    const sa = Y.encodeStateVector(a), sb = Y.encodeStateVector(b);
    setMarkdown(a, "XAAY\n"); // insert AA between X and Y
    setMarkdown(b, "XBBY\n"); // insert BB between X and Y (same spot)
    applyUpdate(b, Y.encodeStateAsUpdate(a, sb));
    applyUpdate(a, Y.encodeStateAsUpdate(b, sa));
    expect(getMarkdown(a)).toBe(getMarkdown(b)); // converged deterministically
    const merged = getMarkdown(a);
    expect(merged).toContain("AA");
    expect(merged).toContain("BB"); // neither side's insert was lost
  });

  it("a long sequence of agent edits ends at exactly the last state", () => {
    const doc = createDoc("v0\n");
    for (let i = 1; i <= 300; i++) setMarkdown(doc, `# Heading ${i}\n\nbody ${i}\n`);
    expect(getMarkdown(doc)).toBe("# Heading 300\n\nbody 300\n");
  });

  it("preserves no-trailing-newline and CRLF verbatim", () => {
    expect(getMarkdown(createDoc("no newline"))).toBe("no newline");
    expect(getMarkdown(createDoc("crlf\r\nline\r\n"))).toBe("crlf\r\nline\r\n");
    expect(getMarkdown(createDoc("  leading and trailing  \n"))).toBe("  leading and trailing  \n");
  });
});

describe("surrogate-split diff boundary (the sharpest UTF-16 case)", () => {
  it("swapping one emoji for another (boundary inside the surrogate pair) is exact", () => {
    const doc = createDoc("😀"); // U+1F600
    setMarkdown(doc, "😁");       // U+1F601 — shares the high surrogate
    expect(getMarkdown(doc)).toBe("😁");
    expect([...getMarkdown(doc)].length).toBe(1); // one whole code point, no lone surrogate
  });
  it("emoji swap mid-sentence stays valid", () => {
    const doc = createDoc("I feel 😀 today\n");
    setMarkdown(doc, "I feel 😢 today\n");
    expect(getMarkdown(doc)).toBe("I feel 😢 today\n");
  });
  it("emoji swap converges across two clients", () => {
    const a = createDoc("mood: 😀\n");
    const b = createDoc();
    applyUpdate(b, encodeUpdate(a));
    const sa = Y.encodeStateVector(a), sb = Y.encodeStateVector(b);
    setMarkdown(a, "mood: 😢\n");
    applyUpdate(b, Y.encodeStateAsUpdate(a, sb));
    applyUpdate(a, Y.encodeStateAsUpdate(b, sa));
    expect(getMarkdown(a)).toBe("mood: 😢\n");
    expect(getMarkdown(b)).toBe("mood: 😢\n");
  });
});

describe("hardening", () => {
  it("three clients with concurrent edits all converge", () => {
    const base = "# Doc\n\nP1.\n\nP2.\n\nP3.\n";
    const docs = [createDoc(base), createDoc(base), createDoc(base)];
    // share history from docs[0]
    const u0 = encodeUpdate(docs[0]);
    applyUpdate(docs[1], u0); applyUpdate(docs[2], u0);
    const svs = docs.map((d) => Y.encodeStateVector(d));
    setMarkdown(docs[0], "# Doc\n\nP1 by zero.\n\nP2.\n\nP3.\n");
    setMarkdown(docs[1], "# Doc\n\nP1.\n\nP2 by one.\n\nP3.\n");
    setMarkdown(docs[2], "# Doc\n\nP1.\n\nP2.\n\nP3 by two.\n");
    // full mesh exchange
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++)
        if (i !== j) applyUpdate(docs[j], Y.encodeStateAsUpdate(docs[i], svs[j]));
    expect(getMarkdown(docs[0])).toBe(getMarkdown(docs[1]));
    expect(getMarkdown(docs[1])).toBe(getMarkdown(docs[2]));
    for (const frag of ["by zero", "by one", "by two"]) expect(getMarkdown(docs[0])).toContain(frag);
  });

  it("clearing to empty and back is exact", () => {
    const doc = createDoc("# Something\n\nbody\n");
    setMarkdown(doc, "");
    expect(getMarkdown(doc)).toBe("");
    setMarkdown(doc, "# Back\n");
    expect(getMarkdown(doc)).toBe("# Back\n");
  });

  it("deleting a large middle chunk keeps prefix and suffix identity", () => {
    const doc = createDoc("KEEP-START\n" + "middle line\n".repeat(500) + "KEEP-END\n");
    const ytext = doc.getText("source");
    const endAnchor = Y.createRelativePositionFromTypeIndex(ytext, ytext.length - 5); // in "KEEP-END"
    setMarkdown(doc, "KEEP-START\nKEEP-END\n");
    const abs = Y.createAbsolutePositionFromRelativePosition(endAnchor, doc);
    expect(abs).not.toBeNull();
    expect(getMarkdown(doc)).toBe("KEEP-START\nKEEP-END\n");
  });

  it("applyFastDiff is idempotent when target already reached", () => {
    const doc = createDoc("stable\n");
    const t = doc.getText("source");
    applyFastDiff(t, t.toString(), "stable\n"); // no-op
    expect(getMarkdown(doc)).toBe("stable\n");
  });
});
