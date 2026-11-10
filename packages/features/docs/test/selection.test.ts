import { describe, it, expect } from "vitest";
import { mapPositionThroughEdit, mapSelectionThroughEdit } from "../src/logic/selection";

// Selection preservation (roadmap B5). The whole point: a remote edit ELSEWHERE
// must not move your caret, and an edit before it must carry it along — so live
// co-editing never yanks the cursor. These pin exactly that behaviour on the pure
// offset math the editor wiring rests on.

// A little helper: put a "|" at the caret so the intent reads at a glance.
const at = (s: string) => s.indexOf("|");
const strip = (s: string) => s.replace("|", "");

describe("mapPositionThroughEdit", () => {
  it("leaves the caret put when the edit is AFTER it", () => {
    // caret after "abc"; someone appends "XYZ" further along
    const before = "abc|defg", after = "abcdefgXYZ";
    expect(mapPositionThroughEdit(strip(before), after, at(before))).toBe(3);
  });

  it("carries the caret along when text is INSERTED before it", () => {
    // caret after "hello "; someone types "big " at the very start
    const before = "hello |world", after = "big hello world";
    expect(mapPositionThroughEdit(strip(before), after, at(before))).toBe(at(before) + 4);
  });

  it("pulls the caret back when text is DELETED before it", () => {
    // caret after "The quick "; "quick " (6 chars) is removed
    const before = "The quick |fox", after = "The fox";
    expect(mapPositionThroughEdit(strip(before), after, at(before))).toBe(at(before) - 6);
  });

  it("ignores a deletion AFTER the caret", () => {
    const before = "keep| me here", after = "keep";
    expect(mapPositionThroughEdit(strip(before), after, at(before))).toBe(4);
  });

  it("returns the caret unchanged when nothing changed", () => {
    expect(mapPositionThroughEdit("same text", "same text", 4)).toBe(4);
  });

  it("collapses a caret sitting inside deleted text to the change point", () => {
    // caret inside "MIDDLE"; the whole middle is replaced by "X"
    const before = "start MID|DLE end", after = "start X end";
    const mapped = mapPositionThroughEdit(strip(before), after, at(before));
    // lands within the new region, never past its end ("start X" = 7)
    expect(mapped).toBeLessThanOrEqual("start X".length);
    expect(mapped).toBeGreaterThanOrEqual("start ".length);
  });

  it("clamps an out-of-range caret rather than returning nonsense", () => {
    // 999 clamps to the end of `before` (3); the append is AFTER the caret, so it
    // stays — an edit past your cursor never pulls it forward.
    expect(mapPositionThroughEdit("abc", "abcdef", 999)).toBe(3);
    expect(mapPositionThroughEdit("abc", "xabc", -5)).toBe(0);
  });

  // A replacement of different length that ends before the caret shifts it by the
  // net delta — the common case of a collaborator rewording an earlier sentence.
  it("shifts by the net delta when an earlier span is replaced", () => {
    const before = "one two |tail", after = "ONE zwei two-ish tail"; // longer earlier span
    const mapped = mapPositionThroughEdit(strip(before), after, at(before));
    expect(after.slice(0, mapped)).toBe("ONE zwei two-ish "); // caret still before "tail"
    expect(after.slice(mapped)).toBe("tail");
  });
});

describe("mapSelectionThroughEdit", () => {
  it("moves both ends of a selection through an earlier insertion", () => {
    // selection over "world"; "big " inserted at the start
    const before = "hello world", after = "big hello world";
    const sel = mapSelectionThroughEdit(before, after, 6, 11); // "world"
    expect(after.slice(sel.from, sel.to)).toBe("world");
  });

  it("leaves a selection untouched by a later edit", () => {
    const before = "pick THIS then more", after = "pick THIS then MORE!!";
    const sel = mapSelectionThroughEdit(before, after, 5, 9); // "THIS"
    expect(sel).toEqual({ from: 5, to: 9 });
    expect(after.slice(sel.from, sel.to)).toBe("THIS");
  });
});
