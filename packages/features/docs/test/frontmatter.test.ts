import { describe, it, expect } from "vitest";
import { markdownToDoc, docToMarkdown } from "../src/logic/markdown";

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
