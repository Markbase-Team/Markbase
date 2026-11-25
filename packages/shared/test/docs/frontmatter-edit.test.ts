import { describe, it, expect } from "vitest";
import { withFrontmatterField } from "../../src/docs/frontmatter-edit";
import { splitFrontmatter } from "../../src/docs/markdown";

describe("withFrontmatterField", () => {
  it("changes only the field's own line", () => {
    const md = "---\ntype: task\n# who\nassignee: human:u1\ndue: 2026-11-28\ndone: false\ntitle: 'Quoted'\n---\n\nBody.\n";
    expect(withFrontmatterField(md, "done", true)).toBe(md.replace("done: false", "done: true"));
  });

  it("adds the field when it isn't there", () => {
    expect(withFrontmatterField("---\ntype: task\n---\n\nBody.", "done", true)).toBe("---\ntype: task\ndone: true\n---\n\nBody.");
  });

  it("replaces a field written over several lines", () => {
    const out = withFrontmatterField("---\ndone:\n  - weird\nafter: 1\n---\nBody", "done", false);
    expect(splitFrontmatter(out).frontmatter).toEqual({ done: false, after: 1 });
  });

  it("writes lists and text YAML can read back", () => {
    const out = withFrontmatterField("---\ntype: incident\n---\n", "tags", ["db", "on: call"]);
    expect(splitFrontmatter(out).frontmatter).toEqual({ type: "incident", tags: ["db", "on: call"] });
  });

  it("gives a document without front matter a block above its text", () => {
    expect(withFrontmatterField("# Title\n\nBody.", "done", true)).toBe("---\ndone: true\n---\n\n# Title\n\nBody.");
  });
});
