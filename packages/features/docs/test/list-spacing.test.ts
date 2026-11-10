import { describe, it, expect } from "vitest";
import { markdownToDoc, docToMarkdown } from "../src/logic/markdown";

// Lists were rewritten loose on the way back to disk — a blank line inserted
// between every item, in every document, on every save:
//
//     - one        →    - one
//     - two             <blank>
//     - three           - two
//
// prosemirror-markdown takes this from `node.attrs.tight`, and TipTap's list
// nodes have no such attribute, so it fell through to the loose default. This is
// not a formatting preference; it is the file changing under the author.

const trip = (markdown: string): string => docToMarkdown(markdownToDoc(markdown)).trim();

describe("a list survives the round trip", () => {
  it("bullets stay on consecutive lines", () => {
    expect(trip("- one\n- two\n- three\n")).toBe("- one\n- two\n- three");
  });

  it("numbers stay on consecutive lines", () => {
    expect(trip("1. one\n2. two\n")).toBe("1. one\n2. two");
  });

  it("task lists keep their boxes and their spacing", () => {
    expect(trip("- [ ] todo\n- [x] done\n")).toBe("- [ ] todo\n- [x] done");
  });

  it("nesting keeps its indentation and gains no blank lines", () => {
    expect(trip("- one\n  - nested\n- two\n")).toBe("- one\n  - nested\n- two");
  });

  it("a long list does not grow every time it is saved", () => {
    const list = Array.from({ length: 8 }, (_, i) => `- item ${i + 1}`).join("\n");
    expect(trip(list)).toBe(list);
    expect(trip(trip(list))).toBe(list); // idempotent: saving twice changes nothing
  });
});

describe("what a tight list must not swallow", () => {
  it("paragraphs are still separated by a blank line", () => {
    expect(trip("para one\n\npara two\n")).toBe("para one\n\npara two");
  });

  it("text after a list is still its own block", () => {
    expect(trip("- a\n- b\n\ntext after\n")).toBe("- a\n- b\n\ntext after");
  });

  it("a heading still stands apart from the list under it", () => {
    expect(trip("# Title\n\n- a\n- b\n")).toBe("# Title\n\n- a\n- b");
  });
});

describe("the accepted cost", () => {
  it("a deliberately loose list comes back tight", () => {
    // The schema carries no `tight` attribute, so looseness is already gone by
    // the time we serialize. Between mangling every tight list and flattening
    // the rare loose one, this is the trade being made — recorded here so it is
    // a decision rather than a surprise.
    expect(trip("- one\n\n- two\n")).toBe("- one\n- two");
  });
});
