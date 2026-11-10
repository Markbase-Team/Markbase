import { describe, it, expect } from "vitest";
import { docSchema } from "../src/logic/schema";
import { markdownToDoc, docToMarkdown } from "../src/logic/markdown";

// Markdown is the truth here: the editor serializes to markdown on every
// keystroke, and anything that changes the markdown from elsewhere — a remote
// edit, the file on disk, or Cmd+Z, which drives Y.UndoManager over the source
// text — re-derives the editor's content by parsing it back.
//
// So a checkbox that does not survive markdown does not survive undo. An EMPTY
// checkbox did not: it serializes as "- [ ] ", markdown-it drops the trailing
// space, and the item's text is exactly "[ ]" — which the task pattern refused,
// because it demanded whitespace after the bracket. And a list only becomes a
// taskList when EVERY item is one, so one untyped box took the whole list down
// with it, filled items included.

const taskList = (items: Array<[boolean, string]>) =>
  docSchema.node("doc", null, [
    docSchema.node(
      "taskList",
      null,
      items.map(([checked, text]) =>
        docSchema.node("taskItem", { checked }, [
          docSchema.node("paragraph", null, text ? [docSchema.text(text)] : []),
        ])
      )
    ),
  ]);

/** What the editor would show after a save and a re-derive. */
const rederive = (doc: ReturnType<typeof taskList>) => markdownToDoc(docToMarkdown(doc));

const boxes = (doc: ReturnType<typeof markdownToDoc>) => {
  const list = doc.firstChild;
  if (!list || list.type.name !== "taskList") return null;
  const out: Array<[boolean, string]> = [];
  list.forEach((item) => out.push([item.attrs.checked === true, item.textContent]));
  return out;
};

describe("an empty checkbox survives the round trip", () => {
  it("stays a checkbox instead of becoming a bullet reading [ ]", () => {
    expect(boxes(rederive(taskList([[false, ""]])))).toEqual([[false, ""]]);
  });

  it("does not drag the rest of the list down with it", () => {
    const doc = taskList([[false, "buy milk"], [true, "pay rent"], [false, ""]]);
    expect(boxes(rederive(doc))).toEqual([
      [false, "buy milk"],
      [true, "pay rent"],
      [false, ""],
    ]);
  });

  it("keeps a checked-but-empty box checked", () => {
    expect(boxes(rederive(taskList([[true, ""]])))).toEqual([[true, ""]]);
  });

  it("holds still across repeated saves", () => {
    const once = docToMarkdown(rederive(taskList([[false, ""], [false, "later"]])));
    const twice = docToMarkdown(markdownToDoc(once));
    expect(twice).toBe(once);
  });
});

describe("checkboxes written by hand", () => {
  it("reads a bare '- [ ]' the way GitHub does — an empty box", () => {
    expect(boxes(markdownToDoc("- [ ]\n- [x]\n"))).toEqual([
      [false, ""],
      [true, ""],
    ]);
  });

  it("still reads boxes with text", () => {
    expect(boxes(markdownToDoc("- [ ] todo\n- [x] done\n"))).toEqual([
      [false, "todo"],
      [true, "done"],
    ]);
  });
});

describe("what must not turn into a checkbox", () => {
  it("a bullet whose text merely starts with a bracket", () => {
    expect(boxes(markdownToDoc("- [link](http://example.com)\n"))).toBeNull();
    expect(boxes(markdownToDoc("- [note] see below\n"))).toBeNull();
  });

  it("an ordinary bullet list", () => {
    expect(boxes(markdownToDoc("- one\n- two\n"))).toBeNull();
  });
});
