import { describe, it, expect } from "vitest";
import { docReplaceSteps } from "../src/logic/restore";
import { applySteps } from "../src/logic/steps";
import { markdownToDoc } from "../src/logic/markdown";

type ReplaceJson = {
  stepType: string;
  from: number;
  to: number;
  slice?: { content?: Array<{ type: string; text?: string }> };
};

describe("docReplaceSteps — minimal diff, not a whole-doc clobber", () => {
  it("identical docs produce no steps", () => {
    const d = markdownToDoc("# Same\n\nbody\n").toJSON();
    expect(docReplaceSteps(d, d)).toEqual([]);
  });

  it("appending a paragraph is one small step over the changed range", () => {
    const cur = markdownToDoc("# A\n\nkeep this\n").toJSON();
    const tgt = markdownToDoc("# A\n\nkeep this\n\nNEW PARAGRAPH\n").toJSON();
    const steps = docReplaceSteps(cur, tgt);

    expect(steps).toHaveLength(1);
    const s = steps[0] as ReplaceJson;
    expect(s.stepType).toBe("replace");
    // The step starts at the change, not at the top of the document.
    expect(s.from).toBeGreaterThan(3);
    const slice = JSON.stringify(s.slice);
    expect(slice).toContain("NEW PARAGRAPH");
    expect(slice).not.toContain("keep this"); // unchanged text isn't carried

    // …and applying it turns current into target exactly.
    expect(applySteps(cur, steps)).toEqual(tgt);
  });

  it("editing the middle only replaces the middle", () => {
    const cur = markdownToDoc("# Title\n\nold middle\n\ntail\n").toJSON();
    const tgt = markdownToDoc("# Title\n\nnew middle\n\ntail\n").toJSON();
    const steps = docReplaceSteps(cur, tgt);
    expect(steps).toHaveLength(1);
    const slice = JSON.stringify((steps[0] as ReplaceJson).slice);
    expect(slice).not.toContain("Title");
    expect(slice).not.toContain("tail");
    expect(applySteps(cur, steps)).toEqual(tgt);
  });
});
