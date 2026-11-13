import { describe, it, expect } from "vitest";
import { parseAuditArgs } from "../src/audit";

// The ledger and the hook parsing are tested with @markbase/vault; this pins
// the commands' own flags.

describe("parseAuditArgs", () => {
  it("reads a hook run's one flag, in both spellings", () => {
    expect(parseAuditArgs(["--agent", "claude"])).toMatchObject({ agent: "claude", report: false, before: false });
    expect(parseAuditArgs(["--agent=codex"]).agent).toBe("codex");
    expect(parseAuditArgs([]).agent).toBeNull();
  });

  it("reads a manual run and a report", () => {
    expect(parseAuditArgs(["--agent", "aider", "--file", "notes/a.md", "--before"])).toMatchObject({
      agent: "aider",
      file: "notes/a.md",
      before: true,
    });
    expect(parseAuditArgs(["report", "--json", "--file=notes/a.md"])).toMatchObject({
      report: true,
      json: true,
      file: "notes/a.md",
    });
  });
});
