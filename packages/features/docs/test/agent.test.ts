import { describe, it, expect } from "vitest";
import { Node } from "prosemirror-model";
import { docSchema } from "../src/logic/schema";
import { markdownToDoc, docToMarkdown } from "../src/logic/markdown";
import { applySteps } from "../src/logic/steps";
import { anchoredEditToSteps } from "../src/logic/agent";

describe("anchoredEditToSteps", () => {
  it("turns an anchored edit into steps that apply to the doc", () => {
    const doc = markdownToDoc("Run the worker once.");
    const steps = anchoredEditToSteps(doc.toJSON(), {
      quote: "once",
      insert: "twice",
    });
    const newJson = applySteps(doc.toJSON(), steps);
    expect(docToMarkdown(Node.fromJSON(docSchema, newJson)).trim()).toBe(
      "Run the worker twice."
    );
  });

  it("deletes the matched text when insert is empty", () => {
    const doc = markdownToDoc("keep remove this");
    const steps = anchoredEditToSteps(doc.toJSON(), {
      quote: "remove ",
      insert: "",
    });
    const newJson = applySteps(doc.toJSON(), steps);
    expect(docToMarkdown(Node.fromJSON(docSchema, newJson)).trim()).toBe(
      "keep this"
    );
  });

  it("throws when the anchor isn't found", () => {
    const doc = markdownToDoc("hello world");
    expect(() =>
      anchoredEditToSteps(doc.toJSON(), { quote: "zzz", insert: "x" })
    ).toThrow();
  });
});

describe("anchoredEditToSteps — markdown structure", () => {
  const md = (json: object) => docToMarkdown(Node.fromJSON(docSchema, json));

  it("preserves inline markup and merges it into the target block", () => {
    const doc = markdownToDoc("Status: draft");
    const steps = anchoredEditToSteps(doc.toJSON(), {
      quote: "draft",
      insert: "**ready** for review",
    });
    const out = md(applySteps(doc.toJSON(), steps)).trim();
    expect(out).toBe("Status: **ready** for review");
  });

  it("inserts block structure (heading + list) as real nodes", () => {
    const doc = markdownToDoc("# Title\n\nBody.");
    const steps = anchoredEditToSteps(doc.toJSON(), {
      quote: "Body.",
      insert: "Body.\n\n## New\n\n- a\n- b",
    });
    const out = md(applySteps(doc.toJSON(), steps));
    expect(out).toContain("## New");
    expect(out).toContain("- a");
    expect(out).toContain("- b");
  });
});

describe("anchoredEditToSteps — cross-block", () => {
  it("resolves and replaces a quote spanning a block boundary", () => {
    // Heading "c" + paragraph "version 2" — a selection across both is captured
    // as "c version 2" (space at the block boundary).
    const doc = markdownToDoc("# c\n\nversion 2");
    const steps = anchoredEditToSteps(doc.toJSON(), {
      quote: "c version 2",
      insert: "replaced",
    });
    const newJson = applySteps(doc.toJSON(), steps);
    expect(docToMarkdown(Node.fromJSON(docSchema, newJson))).toContain(
      "replaced"
    );
  });
})
