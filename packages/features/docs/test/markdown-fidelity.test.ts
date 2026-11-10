import { describe, it, expect } from "vitest";
import { markdownToDoc, docJsonToMarkdown } from "../src/logic/markdown";
import type { DocJSON } from "../src/logic/types";

// The CRDT editor is Y.Text-is-truth: it derives a ProseMirror doc from the
// stored markdown (markdownToDoc) and, on every keystroke, serializes the editor
// back to markdown (docJsonToMarkdown) to diff into the Y.Text. So the round-trip
//   markdown -> doc -> markdown
// must be a STABLE fixed point, or edits produce spurious diffs / lose content.
// These tests pin exactly what survives that round-trip and what doesn't — the
// unit-level version of "type it in two tabs and compare".
const roundTrip = (md: string): string =>
  docJsonToMarkdown(markdownToDoc(md).toJSON() as DocJSON);

describe("markdown round-trip — lossless (stable fixed point)", () => {
  const stable: Record<string, string> = {
    headings: "# A\n\n## B\n\n### C",
    bold: "**bold** text",
    italic: "*italic* text",
    "bold+italic": "***both***",
    strikethrough: "~~gone~~",
    "inline code": "use `x`",
    link: "[text](https://e.com)",
    "link with title": '[t](https://e.com "title")',
    // B0: images are inline nodes, so they (and the text around them) survive.
    "standalone image": "![alt](img.png)",
    "inline image keeps its surrounding text": "text ![alt](img.png) more",
    "image after a heading": "# H\n\n![a](b.png)",
    "heading with inline mark": "# A **bold** heading",
    autolink: "<https://e.com>",
    blockquote: "> quote",
    "blockquote, two paragraphs": "> p1\n>\n> p2",
    "code block (lang)": "```js\nconst x = 1;\n```",
    "code block (no lang)": "```\nplain\n```",
    "horizontal rule": "a\n\n---\n\nb",
    frontmatter: "---\ntitle: T\n---\n\n# Body",
    paragraphs: "a\n\nb",
    "list then paragraph": "- a\n\ntext",
    // Lists used to be rewritten loose here — a blank line inserted between
    // every item, on every save. See list-spacing.test.ts.
    "tight bullet list": "- a\n- b",
    "tight ordered list": "1. a\n2. b",
    "nested bullets": "- a\n  - b\n    - c",
    "nested ordered": "1. a\n   1. b",
    "task list": "- [ ] todo\n- [x] done",
    emoji: "# 🚀 Ship",
  };
  for (const [name, md] of Object.entries(stable)) {
    it(name, () => expect(roundTrip(md)).toBe(md));
  }
});

describe("markdown round-trip — normalizing (content preserved, syntax rewritten)", () => {
  // These don't lose text, but the markdown changes shape, so every edit to such
  // a block re-diffs the whole block. Pinned so a converter change is noticed.
  const cases: Array<[string, string, string]> = [
    ["table gains a trailing newline", "| A | B |\n| --- | --- |\n| 1 | 2 |", "| A | B |\n| --- | --- |\n| 1 | 2 |\n"],
    ["hard-break spaces become backslash", "line one  \nline two", "line one\\\nline two"],
    ["setext heading becomes ATX", "A\n===", "# A"],
    ["backslash escape is dropped", "a \\* b", "a * b"],
    ["trailing spaces are trimmed", "line with trail  ", "line with trail"],
    // A soft break inside a blockquote is one CommonMark paragraph; both forms
    // render identically, so the words survive — only the source break moves.
    ["multi-line blockquote joins its soft break", "> line one\n> line two", "> line one line two"],
  ];
  for (const [name, input, expected] of cases) {
    it(name, () => expect(roundTrip(input)).toBe(expected));
  }
});

describe("doc structure round-trip — empty paragraphs (the 'lone Return' bug)", () => {
  // Pressing Return makes an empty paragraph, which markdown cannot represent, so
  // it never syncs. This is the doc -> markdown -> doc direction.
  const blocks = (md: string): string[] => {
    const doc = markdownToDoc(md).toJSON() as { content?: Array<{ type: string }> };
    return (doc.content ?? []).map((b) => b.type);
  };
  const toMd = (doc: DocJSON): string => docJsonToMarkdown(doc);

  it("BUG: a trailing empty paragraph produces no markdown change", () => {
    const withEmpty: DocJSON = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "line one" }] },
        { type: "paragraph" },
      ],
    };
    const withoutEmpty: DocJSON = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "line one" }] }],
    };
    // identical markdown → nothing to sync when you press Return
    expect(toMd(withEmpty)).toBe(toMd(withoutEmpty));
  });

  it("BUG: an empty paragraph between two paragraphs is dropped", () => {
    const doc: DocJSON = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "a" }] },
        { type: "paragraph" },
        { type: "paragraph", content: [{ type: "text", text: "b" }] },
      ],
    };
    expect(toMd(doc)).toBe("a\n\nb");
    expect(blocks(toMd(doc))).toEqual(["paragraph", "paragraph"]); // the empty one is gone
  });
});
