import { describe, it, expect } from "vitest";
import { EditorState } from "@tiptap/pm/state";
import { docSchema } from "../src/logic/schema";
import { docToMarkdown } from "../src/logic/markdown";
import { adjacentListBoundary, joinAdjacentLists } from "../src/logic/join-adjacent-lists";

// Delete item 3 of a numbered list and the item after it must read 3, not 1.
// The editor had split the list in two; markdown never had.

const item = (text: string) =>
  docSchema.node("listItem", null, [docSchema.node("paragraph", null, [docSchema.text(text)])]);
const ol = (start: number, ...texts: string[]) =>
  docSchema.node("orderedList", { start }, texts.map(item));
const ul = (...texts: string[]) => docSchema.node("bulletList", null, texts.map(item));
const p = (text: string) => docSchema.node("paragraph", null, [docSchema.text(text)]);
const doc = (...nodes: ReturnType<typeof p>[]) => docSchema.node("doc", null, nodes);

const numbers = (d: ReturnType<typeof doc>): number[][] => {
  const out: number[][] = [];
  d.forEach((n) => {
    if (n.type.name !== "orderedList") return;
    const start = n.attrs.start as number;
    out.push(n.children.map((_, i) => start + i));
  });
  return out;
};

describe("adjacent lists of one kind", () => {
  it("are joined, so the numbering continues", () => {
    const tr = EditorState.create({ doc: doc(ol(1, "a", "b"), ol(1, "d")) }).tr;
    expect(joinAdjacentLists(tr)).toBe(true);
    expect(numbers(tr.doc)).toEqual([[1, 2, 3]]);
    expect(docToMarkdown(tr.doc)).toBe("1. a\n2. b\n3. d");
  });

  it("stay apart when something sits between them", () => {
    const d = doc(ol(1, "a", "b"), p("three, as a paragraph"), ol(1, "d"));
    expect(adjacentListBoundary(d)).toBeNull();
    expect(joinAdjacentLists(EditorState.create({ doc: d }).tr)).toBe(false);
  });

  it("never join a bullet list to a numbered one", () => {
    const d = doc(ol(1, "a"), ul("b"));
    expect(adjacentListBoundary(d)).toBeNull();
  });

  it("are joined inside a list item too", () => {
    const nested = docSchema.node("listItem", null, [p("outer"), ul("x"), ul("y")]);
    const tr = EditorState.create({ doc: doc(docSchema.node("bulletList", null, [nested])) }).tr;
    expect(joinAdjacentLists(tr)).toBe(true);
    expect(docToMarkdown(tr.doc)).toBe("- outer\n  - x\n  - y");
  });
});
