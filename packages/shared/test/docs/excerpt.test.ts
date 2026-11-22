import { describe, expect, it } from "vitest";
import { docExcerpt } from "../../src/docs/excerpt";

describe("docExcerpt", () => {
  it("drops the leading h1 — it is the title — and reads the first paragraph", () => {
    expect(docExcerpt("# Skye in October\n\nThree nights, the cottage near Elgol.\nThe forecast is a rumour.\n")).toBe(
      "Three nights, the cottage near Elgol. The forecast is a rumour."
    );
  });

  it("keeps a heading that is not the first line: it is a section, not the title", () => {
    expect(docExcerpt("Intro line.\n\n## Later\n\nMore.")).toBe("Intro line. Later More.");
  });

  it("drops frontmatter", () => {
    expect(docExcerpt("---\ntitle: Reading list\ntags: [books]\n---\n# Reading list\nThe Peregrine, J. A. Baker")).toBe(
      "The Peregrine, J. A. Baker"
    );
  });

  it("strips markdown punctuation but keeps the words", () => {
    const md = [
      "# T",
      "- [ ] **Two** open shelves above the counter, *oak*, `30mm`, ~~brackets~~ visible.",
      "> See [the plan](https://example.com/plan) and [[Garden plan|the garden]] and [[Dal]].",
      "![photo](shelf.png)",
      "| a | b |",
      "|---|---|",
      "| 1 | 2 |",
      "---",
      "```ts",
      "const x = 1;",
      "```",
      "<br>",
    ].join("\n");
    expect(docExcerpt(md)).toBe(
      "Two open shelves above the counter, oak, 30mm, brackets visible. See the plan and the garden and Dal. a b 1 2 const x = 1;"
    );
  });

  it("is empty for an empty or title-only document", () => {
    expect(docExcerpt("")).toBe("");
    expect(docExcerpt("# Just a title\n\n")).toBe("");
    expect(docExcerpt("---\ntitle: x\n---\n")).toBe("");
  });

  it("cuts long prose on a word boundary with an ellipsis", () => {
    const words = Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ");
    const out = docExcerpt(words, 40);
    expect(out.length).toBeLessThanOrEqual(41);
    expect(out.endsWith("…")).toBe(true);
    expect(out.slice(0, -1).split(" ").every((w) => /^word\d+$/.test(w))).toBe(true);
  });

  it("does not leave a trailing comma before the ellipsis", () => {
    expect(docExcerpt("alpha beta, gamma delta epsilon", 12)).toBe("alpha beta…");
  });

  it("survives a document whose only line is a long unbroken token", () => {
    expect(docExcerpt("x".repeat(500), 20)).toBe("x".repeat(20) + "…");
  });
});
