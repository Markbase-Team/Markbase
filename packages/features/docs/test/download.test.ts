import { describe, it, expect } from "vitest";
import { markdownToDoc, docJsonToMarkdown } from "../src/logic/markdown";
import { docFileSlug, combineTabMarkdown } from "../src/logic/download";

describe("docJsonToMarkdown", () => {
  it("serializes a stored doc_json back to markdown", () => {
    const json = markdownToDoc("# Overview\n\nHello **world**.").toJSON();
    expect(docJsonToMarkdown(json)).toBe("# Overview\n\nHello **world**.");
  });

  it("round-trips GFM structure (headings, lists, links)", () => {
    const src = "# Quick start\n\n- Step one\n- Step two";
    const md = docJsonToMarkdown(markdownToDoc(src).toJSON());
    expect(md).toContain("# Quick start");
    expect(md).toContain("Step one");
    expect(md).toContain("Step two");
    const link = docJsonToMarkdown(
      markdownToDoc("see [docs](https://markbase.so)").toJSON()
    );
    expect(link).toContain("[docs](https://markbase.so)");
  });

  it('returns "" for doc_json that does not parse under the schema', () => {
    expect(docJsonToMarkdown({ type: "nonsense" })).toBe("");
    expect(docJsonToMarkdown({})).toBe("");
  });
});

describe("combineTabMarkdown", () => {
  it("joins tabs with a blank line and a trailing newline", () => {
    expect(combineTabMarkdown(["# A\n\nalpha", "# B\n\nbeta"])).toBe(
      "# A\n\nalpha\n\n# B\n\nbeta\n"
    );
  });

  it("trims each tab and drops empty ones", () => {
    expect(combineTabMarkdown(["  # A  ", "", "   ", "# B"])).toBe(
      "# A\n\n# B\n"
    );
  });

  it("keeps a single tab intact with a trailing newline", () => {
    expect(combineTabMarkdown(["# Only"])).toBe("# Only\n");
  });

  it('returns "" when there is nothing to write', () => {
    expect(combineTabMarkdown([])).toBe("");
    expect(combineTabMarkdown(["", "   "])).toBe("");
  });
});

describe("docFileSlug", () => {
  it("slugifies a title", () => {
    expect(docFileSlug("My Doc!")).toBe("my-doc");
    expect(docFileSlug("Overview: the AI era")).toBe("overview-the-ai-era");
  });

  it("trims leading/trailing separators and caps length at 80", () => {
    expect(docFileSlug("  ...Hello...  ")).toBe("hello");
    expect(docFileSlug("a".repeat(200))).toHaveLength(80);
  });

  it('falls back to "document" when no usable characters remain', () => {
    expect(docFileSlug("")).toBe("document");
    expect(docFileSlug("！！！")).toBe("document");
  });
});
