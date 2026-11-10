import { describe, it, expect } from "vitest";
import { collapseToPrimary, primaryOf } from "../src/logic/tab-group";

// A document is its first tab. Adding tabs, reordering them, or the order rows
// come back in must never change which row stands for the document — that row
// is the URL, the sidebar entry, and the file the vault daemon keeps on disk.

const tab = (id: string, position: number, created_at: string, group = "g") => ({
  id,
  position,
  created_at,
  tab_group_id: group,
});

describe("the primary tab of a group", () => {
  it("is the tab the document was created with, wherever it sits", () => {
    const original = tab("orig", 0, "2026-10-28T18:00:00Z");
    const added = tab("new", -1, "2026-10-28T18:21:00Z");
    expect(primaryOf(original, added)).toBe(original);
    expect(primaryOf(added, original)).toBe(original);
  });

  it("falls back to position, then id, when the timestamps tie", () => {
    const a = tab("b", 1, "t");
    const b = tab("a", 0, "t");
    expect(primaryOf(a, b)).toBe(b);
    expect(primaryOf(tab("b", 0, "t"), tab("a", 0, "t")).id).toBe("a");
  });
});

describe("collapsing rows to one per document", () => {
  it("keeps the original tab even after a new one was inserted below it", () => {
    const rows = [
      tab("new2", -2, "2026-10-28T18:22:00Z"),
      tab("new1", -1, "2026-10-28T18:21:00Z"),
      tab("orig", 0, "2026-10-28T18:00:00Z"),
    ];
    expect(collapseToPrimary(rows).map((r) => r.id)).toEqual(["orig"]);
    expect(collapseToPrimary([...rows].reverse()).map((r) => r.id)).toEqual(["orig"]);
  });

  it("keeps one row per group and leaves other groups alone", () => {
    const rows = [
      tab("a1", 0, "t1", "A"),
      tab("a2", 1, "t2", "A"),
      tab("b1", 5, "t3", "B"),
    ];
    expect(collapseToPrimary(rows).map((r) => r.id).sort()).toEqual(["a1", "b1"]);
  });
});
