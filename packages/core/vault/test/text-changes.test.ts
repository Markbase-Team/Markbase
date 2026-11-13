import { describe, it, expect } from "vitest";
import { changeTotals, textChanges, type TextChange } from "../src/text-changes";

// The write audit's claim is "exactly which characters". These pin that the
// offsets are right — applying the changes to `before` must give `after` —
// for the shapes a real edit takes.

/** Rebuild `after` from `before` and the changes; and check each change against both texts. */
function apply(before: string, after: string, changes: TextChange[]): string {
  let out = "";
  let at = 0;
  for (const c of changes) {
    expect(before.slice(c.oldStart, c.oldStart + c.removed.length)).toBe(c.removed);
    expect(after.slice(c.newStart, c.newStart + c.inserted.length)).toBe(c.inserted);
    out += before.slice(at, c.oldStart) + c.inserted;
    at = c.oldStart + c.removed.length;
  }
  return out + before.slice(at);
}

describe("textChanges", () => {
  it("is empty for equal texts", () => {
    expect(textChanges("same", "same")).toEqual([]);
  });

  it("finds one word replaced, with its offsets", () => {
    const before = "# Plan\n\nShip on Monday.\n";
    const after = "# Plan\n\nShip on Friday.\n";
    const changes = textChanges(before, after);
    expect(apply(before, after, changes)).toBe(after);
    expect(changes[0].oldStart).toBe(before.indexOf("Mon"));
    expect(changeTotals(changes).inserted).toBeLessThanOrEqual("Friday".length);
  });

  it("records a pure insertion and a pure removal", () => {
    expect(textChanges("ab", "aXb")).toEqual([{ oldStart: 1, newStart: 1, removed: "", inserted: "X" }]);
    expect(textChanges("aXb", "ab")).toEqual([{ oldStart: 1, newStart: 1, removed: "X", inserted: "" }]);
  });

  it("keeps two separate edits as two changes", () => {
    const before = "one two three four five six seven";
    const after = "one TWO three four five SIX seven";
    const changes = textChanges(before, after);
    expect(changes).toHaveLength(2);
    expect(apply(before, after, changes)).toBe(after);
  });

  it("treats a new file as one insertion and a deleted one as one removal", () => {
    expect(textChanges("", "hello")).toEqual([{ oldStart: 0, newStart: 0, removed: "", inserted: "hello" }]);
    expect(textChanges("hello", "")).toEqual([{ oldStart: 0, newStart: 0, removed: "hello", inserted: "" }]);
  });

  it("counts code units, so text after an emoji still lines up", () => {
    const before = "👋 hello world";
    const after = "👋 hello there";
    expect(apply(before, after, textChanges(before, after))).toBe(after);
  });

  it("records a wholesale rewrite of a large file as one replacement", () => {
    const before = "a".repeat(30_000);
    const after = "b".repeat(30_000);
    const changes = textChanges(before, after);
    expect(changes).toHaveLength(1);
    expect(changeTotals(changes)).toEqual({ inserted: 30_000, removed: 30_000 });
  });
});
