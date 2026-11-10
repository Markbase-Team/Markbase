import { describe, it, expect } from "vitest";
import { createDoc, setMarkdown, getMarkdown } from "../src/logic/crdt";
import {
  appendVersion,
  versionDiff,
  versionContent,
  versionCount,
  checkpoint,
  restoreVersion,
} from "../src/logic/versions";

// Selecting a version in the history panel asks one question: what changed IN
// this version? That's the diff between it and the one before it — so version 1,
// having no predecessor, is diffed against nothing and reads as all-added.
//
// Reconstruction is the expensive half (walk to a keyframe, replay patches), so
// this is deliberately a function OF the doc rather than something precomputed:
// a history list shows +N/−M from the stored counts and never reconstructs at
// all; only a click pays for it.

describe("versionDiff", () => {
  it("shows what one version changed", () => {
    const doc = createDoc("");
    appendVersion(doc, "one two three\n");
    appendVersion(doc, "one two three four\n");

    const segs = versionDiff(doc, 1);
    expect(segs.filter((s) => s.added).map((s) => s.value.trim())).toEqual(["four"]);
    expect(segs.filter((s) => s.removed)).toEqual([]);
    // the unchanged text is still there, so the diff renders in context
    expect(segs.map((s) => s.value).join("")).toContain("one two three");
  });

  // Version 1 has nothing before it. Diffing it against the empty string is the
  // honest answer: everything in it is new.
  it("treats the first version as entirely added", () => {
    const doc = createDoc("");
    appendVersion(doc, "hello world\n");
    const segs = versionDiff(doc, 0);
    expect(segs.every((s) => s.added)).toBe(true);
    expect(segs.map((s) => s.value).join("")).toBe("hello world\n");
  });

  it("marks a removal", () => {
    const doc = createDoc("");
    appendVersion(doc, "keep this drop that\n");
    appendVersion(doc, "keep this\n");
    const segs = versionDiff(doc, 1);
    expect(segs.filter((s) => s.removed).map((s) => s.value.trim()).join(" ")).toContain("drop");
    expect(segs.filter((s) => s.added)).toEqual([]);
  });

  it("shows a replacement as both a removal and an addition", () => {
    const doc = createDoc("");
    appendVersion(doc, "the quick brown fox\n");
    appendVersion(doc, "the quick red fox\n");
    const segs = versionDiff(doc, 1);
    expect(segs.some((s) => s.removed && s.value.includes("brown"))).toBe(true);
    expect(segs.some((s) => s.added && s.value.includes("red"))).toBe(true);
  });

  it("diffs correctly across a patch chain, not just adjacent keyframes", () => {
    const doc = createDoc("");
    for (let i = 0; i < 5; i++) appendVersion(doc, `line ${i}\ncommon tail\n`);
    // version 4 vs version 3 — both reconstructed through patches
    const segs = versionDiff(doc, 4);
    expect(segs.some((s) => s.added && s.value.includes("4"))).toBe(true);
    expect(segs.some((s) => s.removed && s.value.includes("3"))).toBe(true);
    // and the reconstruction it rests on is still exact
    expect(versionContent(doc, 4)).toBe("line 4\ncommon tail\n");
  });

  it("reports no change for a version whose text matched (defensive)", () => {
    const doc = createDoc("");
    appendVersion(doc, "same\n");
    // appendVersion refuses a duplicate, so index 1 shouldn't exist
    expect(appendVersion(doc, "same\n")).toBe(false);
    expect(() => versionDiff(doc, 1)).toThrow(/No version/);
  });

  it("refuses an index that isn't there rather than inventing a diff", () => {
    const doc = createDoc("");
    appendVersion(doc, "x\n");
    expect(() => versionDiff(doc, 5)).toThrow(/No version/);
    expect(() => versionDiff(doc, -1)).toThrow(/No version/);
  });
});

// Restoring an old version writes it back as a NEW edit — never a rewind. The
// roadmap's own words: "append as a new state". Rewinding would delete history
// other devices still hold, and a CRDT would merge it straight back anyway.
describe("restoreVersion", () => {
  it("makes an old version the current content, as a new edit", () => {
    const doc = createDoc("");
    appendVersion(doc, "# Draft one\n");
    appendVersion(doc, "# Draft two\n");
    setMarkdown(doc, "# Draft two\n");

    restoreVersion(doc, 0);
    expect(getMarkdown(doc)).toBe("# Draft one\n");
  });

  it("keeps the history it restored from — nothing is rewound", () => {
    const doc = createDoc("");
    appendVersion(doc, "# One\n");
    appendVersion(doc, "# Two\n");
    restoreVersion(doc, 0);

    // Both versions still there; restoring is not deleting.
    expect(versionCount(doc)).toBe(2);
    expect(versionContent(doc, 0)).toBe("# One\n");
    expect(versionContent(doc, 1)).toBe("# Two\n");
  });

  // The restore itself becomes a version once editing settles, so "undo the
  // restore" is just another restore. That falls out of appending, not a special case.
  it("the restored content is checkpointable like any other edit", () => {
    const doc = createDoc("");
    appendVersion(doc, "# One\n");
    appendVersion(doc, "# Two\n");
    restoreVersion(doc, 0);

    expect(checkpoint(doc)).toBe(true); // the restore is itself history now
    expect(versionCount(doc)).toBe(3);
    expect(versionContent(doc, 2)).toBe("# One\n");
  });

  it("refuses a version that doesn't exist rather than blanking the doc", () => {
    const doc = createDoc("# Live content\n");
    appendVersion(doc, "# Live content\n");
    expect(() => restoreVersion(doc, 9)).toThrow(/No version/);
    expect(getMarkdown(doc)).toBe("# Live content\n"); // untouched
  });
});
