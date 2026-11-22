import { describe, expect, it } from "vitest";
import { agentTools } from "../../src/docs/agent-tools";
import { toolAnnotations } from "../../src/endpoint-tools";

// What Claude's connector directory checks before listing a server: every
// tool has a short title and says whether it only reads or may change data.
describe("every tool an agent is offered", () => {
  const tools = agentTools();

  it("has a short title that is not just its name", () => {
    for (const t of tools) {
      const { title } = toolAnnotations(t);
      expect(title.length, t.name).toBeGreaterThan(3);
      expect(title.length, t.name).toBeLessThanOrEqual(48);
      expect(title, t.name).not.toBe(t.name);
    }
    expect(new Set(tools.map((t) => toolAnnotations(t).title)).size).toBe(tools.length);
  });

  it("is read-only, or a write that says whether it may change or remove something", () => {
    for (const t of tools) {
      const a = toolAnnotations(t);
      if (a.readOnlyHint) expect(a.destructiveHint, t.name).toBe(false);
      if (t.destructive) expect(a.destructiveHint, t.name).toBe(true);
      expect(a.openWorldHint).toBe(false);
    }
    const byName = Object.fromEntries(tools.map((t) => [t.name, toolAnnotations(t)]));
    expect(byName.docs_editDoc.destructiveHint).toBe(true);
    expect(byName.docs_publish.destructiveHint).toBe(true);
    expect(byName.docs_createDoc.destructiveHint).toBe(false);
    expect(byName.docs_addComment.destructiveHint).toBe(false);
    expect(byName.docs_readDoc.readOnlyHint).toBe(true);
  });

  it("has a name of 64 characters or fewer", () => {
    for (const t of tools) expect(t.name.length).toBeLessThanOrEqual(64);
  });
});
