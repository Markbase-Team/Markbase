import { describe, it, expect } from "vitest";
import { retitleLeadingH1, leadingH1 } from "../src/logic/markdown";

// A rename made in the sidebar reaches the heading at the top of the document,
// the way a heading typed at the top reaches the sidebar. Only a LEADING h1 —
// the same line leadingH1 reads — and never one the document does not have.

describe("retitling the leading h1", () => {
  it("rewrites the opening heading and nothing else", () => {
    const md = "# Old name\n\nbody with # not a heading\n\n# A section\n";
    const out = retitleLeadingH1(md, "New name");
    expect(out).toBe("# New name\n\nbody with # not a heading\n\n# A section\n");
    expect(leadingH1(out)).toBe("New name");
  });

  it("looks past frontmatter and blank lines", () => {
    const md = "---\ntags: [a]\n---\n\n\n# Old\ntext\n";
    expect(retitleLeadingH1(md, "New")).toBe("---\ntags: [a]\n---\n\n\n# New\ntext\n");
  });

  it("leaves a document alone when its first content is not an h1", () => {
    for (const md of ["Just a paragraph\n\n# Later heading\n", "## A section\n", ""]) {
      expect(retitleLeadingH1(md, "New")).toBe(md);
    }
  });

  it("is a no-op for the title it already has, and for an empty title", () => {
    expect(retitleLeadingH1("# Same\n", "Same")).toBe("# Same\n");
    expect(retitleLeadingH1("# Same\n", "  ")).toBe("# Same\n");
  });
});
