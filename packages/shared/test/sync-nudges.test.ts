import { describe, expect, it } from "vitest";
import { isNudgeKind } from "../src/sync-nudges";

describe("isNudgeKind", () => {
  it("knows the two kinds of change and nothing else", () => {
    expect(["content", "structure"].every((k) => isNudgeKind(k))).toBe(true);
    for (const k of ["", "delete", null, undefined]) expect(isNudgeKind(k)).toBe(false);
  });
});
