import { describe, it, expect } from "vitest";
import { markdownToDoc, docToMarkdown } from "../../src/docs/markdown";

describe("frontmatter round-trip", () => {
  it("preserves YAML frontmatter + body", () => {
    const md = `---
type: source
tags:
  - a
  - b
---

# Title

Body text.
`;
    const out = docToMarkdown(markdownToDoc(md));
    expect(out).toContain("type: source");
    expect(out).toContain("- a");
    expect(out).toContain("# Title");
    expect(out).toContain("Body text.");
  });

  it("stores frontmatter as a top node with a data attr", () => {
    const doc = markdownToDoc("---\ntype: note\n---\n\nhi\n");
    expect(doc.firstChild?.type.name).toBe("frontmatter");
    expect(doc.firstChild?.attrs.data).toEqual({ type: "note" });
  });

  it("no frontmatter block for docs without one", () => {
    expect(docToMarkdown(markdownToDoc("# Just a doc\n"))).not.toContain("---");
  });
});

describe("frontmatter dates", () => {
  it("keeps a date and a date-time as they were written, through a round trip", () => {
    const md = "---\ntype: task\ndue: 2026-11-26\nstarted_at: 2026-11-28T03:00:00Z\n---\n\nShip it.";
    expect(docToMarkdown(markdownToDoc(md))).toBe(md);
  });

  it("reads a date as the text it was written as, not as a Date", () => {
    const fm = markdownToDoc("---\ndue: 2026-11-26\n---\n\nx").firstChild!.attrs.data as Record<string, unknown>;
    expect(fm.due).toBe("2026-11-26");
  });
});
