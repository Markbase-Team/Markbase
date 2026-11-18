import { describe, it, expect, vi } from "vitest";
import type { AuditHookResult } from "@markbase/node";
import { AUDIT_HOOKS_ENV, auditHooksOff, ensureAuditHooks } from "../src/audit-hooks";

// The app adds the audit hooks at launch. These pin when it does not (the
// switch, a signed-out machine) and what reaches the vault log: one line per
// agent that gained hooks, one per agent whose file was left alone, nothing
// for an agent that already had them.

const result = (
  name: string,
  status: AuditHookResult["status"],
  detail = ""
): AuditHookResult => ({
  target: "claude-code",
  name,
  path: `/home/me/${name}`,
  status,
  added: status === "installed" ? 3 : 0,
  detail,
});

describe("auditHooksOff", () => {
  it("is off only when the variable says so", () => {
    expect(auditHooksOff({})).toBe(false);
    expect(auditHooksOff({ [AUDIT_HOOKS_ENV]: "on" })).toBe(false);
    expect(auditHooksOff({ [AUDIT_HOOKS_ENV]: "off" })).toBe(true);
  });
});

describe("ensureAuditHooks", () => {
  it("logs one line per agent that gained hooks or was left alone, none for an unchanged one", () => {
    const log = vi.fn();
    const install = vi.fn(() => [
      result("Claude Code", "installed"),
      result("Codex", "unchanged"),
      result("Cursor", "skipped", "/home/me/Cursor is read-only"),
    ]);
    ensureAuditHooks({ log, signedIn: true, env: {}, install });
    expect(install).toHaveBeenCalledTimes(1);
    expect(log.mock.calls.map((c) => c[0])).toEqual([
      "audit hooks added for Claude Code (/home/me/Claude Code): its edits in a vault are now attributed to it",
      "audit hooks not added for Cursor: /home/me/Cursor is read-only",
    ]);
  });

  it("does nothing on a signed-out machine", () => {
    const log = vi.fn();
    const install = vi.fn(() => []);
    ensureAuditHooks({ log, signedIn: false, env: {}, install });
    expect(install).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it("is switched off by the environment, and says so once", () => {
    const log = vi.fn();
    const install = vi.fn(() => []);
    ensureAuditHooks({ log, signedIn: true, env: { [AUDIT_HOOKS_ENV]: "off" }, install });
    expect(install).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toContain(`${AUDIT_HOOKS_ENV}=off`);
  });

  it("survives an installer that throws, with a line in the log", () => {
    const log = vi.fn();
    const install = vi.fn(() => {
      throw new Error("disk on fire");
    });
    expect(ensureAuditHooks({ log, signedIn: true, env: {}, install })).toEqual([]);
    expect(log.mock.calls[0][0]).toContain("disk on fire");
  });
});
