import { describe, it, expect } from "vitest";
import { Node, Slice, Fragment } from "prosemirror-model";
import { ReplaceStep } from "prosemirror-transform";
import { docSchema } from "../src/logic/schema";
import { markdownToDoc, docToMarkdown } from "../src/logic/markdown";
import { applySteps, mapPositionThroughSteps } from "../src/logic/steps";
import { resolveQuoteToRange, remapAnchor } from "../src/logic/anchors";

const SAMPLE = `# Install

Run the worker once.

- step one
- step two
`;

// Build a ReplaceStep that swaps the range [from,to) for some plain text — the
// shape an inline edit produces.
function replaceWithText(from: number, to: number, text: string): ReplaceStep {
  const slice = text
    ? new Slice(Fragment.from(docSchema.text(text)), 0, 0)
    : Slice.empty;
  return new ReplaceStep(from, to, slice);
}

describe("markdown round-trip", () => {
  it("normalizes to a stable fixed point (md -> doc -> md is idempotent)", () => {
    const once = docToMarkdown(markdownToDoc(SAMPLE));
    const twice = docToMarkdown(markdownToDoc(once));
    expect(twice).toBe(once);
  });

  it("preserves content through the round-trip", () => {
    const md = docToMarkdown(markdownToDoc(SAMPLE));
    expect(md).toContain("# Install");
    expect(md).toContain("Run the worker once.");
    expect(md).toContain("step one");
  });
});

describe("anchors", () => {
  it("resolves a quote to a position range that reads back as the quote", () => {
    const doc = markdownToDoc("Run the worker once.");
    const anchor = resolveQuoteToRange(doc.toJSON(), "worker");
    expect(anchor).not.toBeNull();
    const text = doc.textBetween(anchor!.from, anchor!.to);
    expect(text).toBe("worker");
  });

  it("returns null for a quote that isn't present", () => {
    const doc = markdownToDoc("Run the worker once.");
    expect(resolveQuoteToRange(doc.toJSON(), "nonexistent")).toBeNull();
  });
});

describe("apply steps (client/server parity)", () => {
  it("applies a ReplaceStep and the serialized markdown reflects it", () => {
    const doc = markdownToDoc("Run the worker once.");
    const anchor = resolveQuoteToRange(doc.toJSON(), "once")!;
    const step = replaceWithText(anchor.from, anchor.to, "twice");

    const newJson = applySteps(doc.toJSON(), [step.toJSON()]);
    const newDoc = Node.fromJSON(docSchema, newJson);
    expect(docToMarkdown(newDoc).trim()).toBe("Run the worker twice.");
  });

  it("throws on a step that doesn't fit the document", () => {
    const doc = markdownToDoc("short");
    const badStep = replaceWithText(999, 1000, "x");
    expect(() => applySteps(doc.toJSON(), [badStep.toJSON()])).toThrow();
  });
});

describe("anchor mapping through edits", () => {
  it("shifts a later anchor when text is inserted before it", () => {
    const doc = markdownToDoc("hello world");
    const anchor = resolveQuoteToRange(doc.toJSON(), "world")!;
    // Insert two characters at the very start of the paragraph text (pos 1).
    const step = replaceWithText(1, 1, "XX");

    const mappedFrom = mapPositionThroughSteps(anchor.from, [step.toJSON()], 1);
    expect(mappedFrom).toBe(anchor.from + 2);
  });

  it("flags an anchor as outdated when its text is deleted", () => {
    const doc = markdownToDoc("delete me please");
    const anchor = resolveQuoteToRange(doc.toJSON(), "delete me ")!;
    const step = replaceWithText(anchor.from, anchor.to, ""); // delete the range

    const { outdated } = remapAnchor(anchor, [step.toJSON()]);
    expect(outdated).toBe(true);
  });
});
