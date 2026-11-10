import { describe, it, expect } from "vitest";
import { markdownToDoc, docToMarkdown } from "../src/logic/markdown";

function roundTrip(md: string): string {
  return docToMarkdown(markdownToDoc(md));
}

describe("GFM round-trip", () => {
  it("strikethrough", () => {
    expect(roundTrip("this is ~~gone~~ text")).toContain("~~gone~~");
  });

  it("task list parses to real taskList/taskItem nodes", () => {
    const doc = markdownToDoc("- [ ] todo\n- [x] done\n");
    const list = doc.firstChild;
    expect(list?.type.name).toBe("taskList");
    expect(list?.firstChild?.type.name).toBe("taskItem");
    expect(list?.firstChild?.attrs.checked).toBe(false);
    expect(list?.child(1)?.attrs.checked).toBe(true);
    const out = roundTrip("- [ ] todo\n- [x] done\n");
    expect(out).toContain("[ ] todo");
    expect(out).toContain("[x] done");
  });

  it("table", () => {
    const out = roundTrip("| a | b |\n| --- | --- |\n| 1 | 2 |\n");
    expect(out).toContain("| a | b |");
    expect(out).toContain("| 1 | 2 |");
  });

  it("highlight (==text==) round-trips", () => {
    const doc = markdownToDoc("a ==hi== b\n");
    expect(JSON.stringify(doc.toJSON())).toContain('"highlight"');
    expect(roundTrip("a ==hi== b\n")).toContain("==hi==");
  });

  it("appends a trailing paragraph so the editor won't (no phantom versions)", () => {
    // A list-ending doc would otherwise get a trailing paragraph from the editor
    // on load, committing a spurious no-op version.
    expect(markdownToDoc("# T\n\n- a\n- b\n").lastChild?.type.name).toBe(
      "paragraph"
    );
    // Paragraph-ending docs are left exactly as-is.
    const types: string[] = [];
    markdownToDoc("# T\n\nhi\n").forEach((n) => types.push(n.type.name));
    expect(types).toEqual(["heading", "paragraph"]);
    // The trailing paragraph round-trips away — no accumulation.
    const md = "# T\n\n- a\n";
    expect(roundTrip(md)).toBe(roundTrip(roundTrip(md)));
  });
});
