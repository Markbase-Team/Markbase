import { describe, it, expect } from "vitest";
import { diffCounts, diffSegments } from "../src/logic/diff";

describe("diffCounts", () => {
  it("counts words added and removed", () => {
    const { added, removed } = diffCounts(
      "the quick brown fox",
      "the slow brown fox jumps"
    );
    expect(added).toBe(2); // "slow", "jumps"
    expect(removed).toBe(1); // "quick"
  });

  it("is zero for identical text", () => {
    expect(diffCounts("same text", "same text")).toEqual({
      added: 0,
      removed: 0,
    });
  });

  it("counts pure insertion", () => {
    expect(diffCounts("", "three new words").added).toBe(3);
  });
});

describe("diffSegments", () => {
  it("marks added and removed segments", () => {
    const segs = diffSegments("hello world", "hello brave world");
    expect(segs.some((s) => s.added && s.value.includes("brave"))).toBe(true);
    expect(segs.some((s) => !s.added && !s.removed)).toBe(true); // unchanged parts
  });
});
