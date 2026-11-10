import { describe, it, expect } from "vitest";
import { pathFollowingTitle } from "../src/server/documents";

// Cloud-first "rename renames the file": a title change updates the doc's path, so
// the vault daemon renames the file on disk to match. This is the pure path
// derivation — keep the folder, sanitize the filename, fall back for an empty name.
describe("pathFollowingTitle", () => {
  it("a root doc's file follows the title", () => {
    expect(pathFollowingTitle("Untitled.md", "NIW Financial Projection")).toBe(
      "NIW Financial Projection.md"
    );
    expect(pathFollowingTitle(null, "My Note")).toBe("My Note.md");
  });

  it("keeps the doc in its current folder", () => {
    expect(pathFollowingTitle("learning/summary/report.md", "Weekly Report")).toBe(
      "learning/summary/Weekly Report.md"
    );
  });

  it("sanitizes filesystem-unsafe characters", () => {
    expect(pathFollowingTitle(null, "a/b:c*?")).toBe("a-b-c-.md");
  });

  it("falls back for an empty/whitespace title", () => {
    expect(pathFollowingTitle(null, "   ")).toBe("untitled.md");
  });
});
