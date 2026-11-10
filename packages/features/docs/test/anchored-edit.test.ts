import { describe, it, expect } from "vitest";
import { createDoc, getMarkdown } from "../src/logic/crdt";
import { applyAnchoredEdit } from "../src/logic/agent";

// An agent edit must not rewrite the rest of the document.
//
// `anchoredEditToSteps` is already surgical — its own comment says "a real,
// targeted operation, NOT a whole-document diff". The damage was downstream: the
// edits route applied those steps to the DERIVED ProseMirror doc and then called
// docJsonToMarkdown on the whole thing, re-serializing every byte of the
// document from structure. That normalizes what the markdown actually said:
//
//   | **`invoice`** | **allowed** |   ->   | invoice | allowed |
//   hard-wrapped prose                 ->   one long line
//   |---|---|                          ->   | --- | --- |
//
// which is precisely the "serialize markdown from structure" failure mode that
// crdt.ts says the Y.Text-is-truth design exists to avoid. It was found by
// running a real agent edit against a real document, which came back with its
// tables flattened.
//
// The fix: when the quote can be located in the markdown SOURCE, splice it there
// and let applyFastDiff touch only those bytes. Everything the edit didn't name
// is then untouched by construction, not by luck. A quote that only exists in
// the rendered projection (marked-up or cross-block text) still falls back to
// the old path — that case stays lossy, and these tests say so rather than
// pretending otherwise.

/** A document with the three things the round-trip destroyed. */
const DOC = `---
title: Billing
---

# Billing

How the wallet works, and where usage lives.
Companion to [[billing-golive]]. All DB objects are in
prod Neon unless noted.

| mode | negative balance | gated? |
|---|---|---|
| **\`invoice\`** | **allowed** | **NEVER** |
| **\`prepaid\`** | allowed to the floor | **YES** |

<!-- marker 12:00:00 -->
`;

const TABLE_ROW = "| **`invoice`** | **allowed** | **NEVER** |";
const WRAPPED = "Companion to [[billing-golive]]. All DB objects are in\nprod Neon unless noted.";

describe("applyAnchoredEdit — a source-level edit leaves the rest alone", () => {
  // The regression, written down: this is the edit that flattened a real
  // document's tables in production.
  it("removes a quoted line without reformatting the document", () => {
    const doc = createDoc(DOC);
    applyAnchoredEdit(doc, { quote: "<!-- marker 12:00:00 -->", insert: "" });
    const out = getMarkdown(doc);

    expect(out).not.toContain("marker 12:00:00");
    // Bold and code marks inside table cells survive.
    expect(out).toContain(TABLE_ROW);
    // The separator row is not rewritten.
    expect(out).toContain("|---|---|");
    // Hard wrapping is not collapsed into one long line.
    expect(out).toContain(WRAPPED);
    // Frontmatter is untouched.
    expect(out.startsWith("---\ntitle: Billing\n---\n")).toBe(true);
  });

  // Stronger than the checks above: nothing outside the quote moved AT ALL.
  it("changes exactly the quoted span and nothing else", () => {
    const doc = createDoc(DOC);
    applyAnchoredEdit(doc, { quote: "<!-- marker 12:00:00 -->", insert: "" });
    expect(getMarkdown(doc)).toBe(DOC.replace("<!-- marker 12:00:00 -->", ""));
  });

  it("reports that it took the source path", () => {
    const doc = createDoc(DOC);
    expect(applyAnchoredEdit(doc, { quote: "prod Neon", insert: "prod Postgres" })).toBe("source");
  });

  it("replaces a quote with markdown, verbatim", () => {
    const doc = createDoc(DOC);
    applyAnchoredEdit(doc, { quote: "unless noted", insert: "unless **noted**" });
    const out = getMarkdown(doc);
    expect(out).toContain("prod Neon unless **noted**.");
    // and the table is still the table
    expect(out).toContain(TABLE_ROW);
  });

  // A word the reader sees inside markup: rendered `invoice`, source
  // **`invoice`**. The plain word IS in the source (inside the marks), so this
  // takes the source path — and the surrounding bold/code survive, which is
  // exactly what the whole-document re-serialize used to destroy.
  it("edits a word inside inline markup without stripping the markup", () => {
    const doc = createDoc(DOC);
    expect(applyAnchoredEdit(doc, { quote: "invoice", insert: "invoiced" })).toBe("source");
    expect(getMarkdown(doc)).toContain("| **`invoiced`** | **allowed** | **NEVER** |");
  });

  // Multiple occurrences: offsetForQuote takes the first. The edit must still be
  // confined to one span rather than replacing every occurrence.
  it("edits one occurrence, not all of them", () => {
    const doc = createDoc("alpha beta\n\nalpha gamma\n");
    applyAnchoredEdit(doc, { quote: "alpha", insert: "ALPHA" });
    expect(getMarkdown(doc)).toBe("ALPHA beta\n\nalpha gamma\n");
  });
});

describe("applyAnchoredEdit — falling back to the rendered projection", () => {
  // "c version 2" exists only in the rendered text (a heading and a paragraph
  // joined by a block separator); the source says "# c\n\nversion 2". The old
  // path is the only one that can resolve it.
  it("falls back when the quote spans a block boundary", () => {
    const doc = createDoc("# c\n\nversion 2\n");
    expect(applyAnchoredEdit(doc, { quote: "c version 2", insert: "replaced" })).toBe("derived");
    expect(getMarkdown(doc)).toContain("replaced");
  });

  // A hard wrap is the honest rendered-only case: the reader sees
  // "...objects are in prod Neon" with a space, because the block separator
  // renders as one; the source has a newline there. No source offset can match,
  // so this still goes the lossy way — recorded as a known limit, not a fix.
  it("falls back for a quote that spans a hard-wrapped line break", () => {
    const doc = createDoc(DOC);
    expect(
      applyAnchoredEdit(doc, { quote: "All DB objects are in prod Neon", insert: "Everything" })
    ).toBe("derived");
    expect(getMarkdown(doc)).toContain("Everything");
  });

  // The route turns this into a 422, so the message has to keep its shape.
  it("throws when the quote is in neither the source nor the rendered text", () => {
    const doc = createDoc(DOC);
    expect(() => applyAnchoredEdit(doc, { quote: "nowhere at all", insert: "x" })).toThrow(
      /anchor not found/i
    );
  });

  it("refuses an empty quote rather than editing at offset zero", () => {
    const doc = createDoc(DOC);
    expect(() => applyAnchoredEdit(doc, { quote: "", insert: "x" })).toThrow(/anchor not found/i);
  });
});
