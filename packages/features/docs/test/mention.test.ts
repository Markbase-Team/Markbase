import { describe, it, expect } from "vitest";
import { docSchema } from "../src/logic/schema";
import { markdownToDoc, docToMarkdown } from "../src/logic/markdown";
import { markdownToHtml, excerpt } from "../src/logic/html";

// A mention is an inline atom in the shared schema, serialized to markdown as a
// plain link (`[@Label](agent:<id>)`) so any markdown reader degrades to readable
// text — and lifted back into a real mention node on parse.

const ID = "3f4c1a2e-0000-4000-8000-abcdefabcdef";

function mentionDoc(label: string, id = ID) {
  return docSchema.node("doc", null, [
    docSchema.node("paragraph", null, [
      docSchema.text("Ask "),
      docSchema.node("mention", { id, label }),
      docSchema.text(" about it."),
    ]),
  ]);
}

describe("mention schema", () => {
  it("is an inline atom", () => {
    const t = docSchema.nodes.mention;
    expect(t.isInline).toBe(true);
    expect(t.isAtom).toBe(true);
  });
});

describe("mention markdown serialization", () => {
  it("writes [@Label](agent:<id>)", () => {
    expect(docToMarkdown(mentionDoc("Roadmap"))).toContain(
      `[@Roadmap](agent:${ID})`
    );
  });

  it("strips ] and newlines from the label so the link can't break", () => {
    const md = docToMarkdown(mentionDoc("Odd]Name\nsecond"));
    expect(md).toContain(`[@OddNamesecond](agent:${ID})`);
  });
});

describe("mention markdown round-trip", () => {
  it("parses [@Label](agent:<id>) back into a mention node", () => {
    const doc = markdownToDoc(`Ask [@Roadmap](agent:${ID}) about it.\n`);
    const found: { id: string; label: string }[] = [];
    doc.descendants((n) => {
      if (n.type.name === "mention") found.push({ id: n.attrs.id, label: n.attrs.label });
    });
    expect(found).toEqual([{ id: ID, label: "Roadmap" }]);
  });

  it("survives doc -> markdown -> doc, and re-serializes identically", () => {
    const before = mentionDoc("Refactor auth");
    const md = docToMarkdown(before);
    const after = markdownToDoc(md);
    const mentions: { id: string; label: string }[] = [];
    after.descendants((n) => {
      if (n.type.name === "mention") mentions.push({ id: n.attrs.id, label: n.attrs.label });
    });
    expect(mentions).toEqual([{ id: ID, label: "Refactor auth" }]);
    // Idempotent: a second pass produces byte-identical markdown.
    expect(docToMarkdown(after)).toBe(md);
  });

  // A mention is an atom, so it contributes no `textContent`. Publishing and
  // excerpts read the *markdown*, where the link text keeps it readable.
  it("keeps the label readable in markdown even though it has no textContent", () => {
    const doc = mentionDoc("Roadmap");
    expect(doc.textContent).not.toContain("@Roadmap");
    expect(docToMarkdown(doc)).toContain("@Roadmap");
  });

  // Published pages render the stored markdown, so the mention must survive
  // markdown-it's link sanitiser (which drops unknown/unsafe schemes).
  it("renders on a published page, and reads sensibly in the excerpt", () => {
    const md = `Ask [@Roadmap](agent:${ID}) about it.`;
    const html = markdownToHtml(md);
    expect(html).toContain("@Roadmap");
    expect(excerpt(md)).toBe("Ask @Roadmap about it.");
  });

  it("leaves ordinary links alone", () => {
    const doc = markdownToDoc("See [the docs](https://markbase.so).\n");
    let mentions = 0;
    doc.descendants((n) => {
      if (n.type.name === "mention") mentions += 1;
    });
    expect(mentions).toBe(0);
    expect(docToMarkdown(doc)).toContain("[the docs](https://markbase.so)");
  });
});
