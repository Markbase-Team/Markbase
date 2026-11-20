import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import type { AuditHookOptions, AuditHookResult, McpInstallResult } from "@markbase/node";

// login.ts reaches the skill installer, which bundles SKILL.md through tsup's
// loader; vitest has no loader for it, and nothing here signs in anyway.
vi.mock("../src/login", () => ({
  ensureAuthenticated: async () => true,
  agentBrowserLogin: async () => "",
}));

import { runMcpInstall, type McpInstallDeps } from "../src/integration/mcp";

// `markbase mcp install` adds the audit hooks to every agent it connects the
// docs server to, and to no other: an agent that got the tools also gets its
// file edits attributed, without a second command.

const MCP: McpInstallResult[] = [
  { target: "desktop", name: "Claude Desktop", status: "installed", detail: "/home/me/claude_desktop_config.json" },
  { target: "claude-code", name: "Claude Code", status: "installed", detail: "claude mcp add" },
  { target: "codex", name: "Codex", status: "skipped", detail: "'codex' is not installed" },
  { target: "cursor", name: "Cursor", status: "installed", detail: "/home/me/.cursor/mcp.json" },
];

function deps(mcp: McpInstallResult[]): McpInstallDeps & { installAuditHooks: ReturnType<typeof vi.fn> } {
  return {
    ensureAuthenticated: async () => true,
    loadConfig: () => ({ apiKey: "jsk_test", appUrl: "https://markbase.example", mirrorDir: "", vaults: [] }),
    savedApiKey: () => "jsk_test",
    installDocsMcp: () => mcp,
    installAuditHooks: vi.fn(
      (opts: AuditHookOptions): AuditHookResult[] =>
        (opts.targets ?? []).map((target) => ({
          target,
          name: target,
          path: `/home/me/${target}`,
          status: "installed",
          added: 2,
          detail: "",
        }))
    ),
  };
}

let output: string[];
beforeEach(() => {
  output = [];
  vi.spyOn(console, "log").mockImplementation((...args: string[]) => {
    output.push(args.join(" "));
  });
});
afterEach(() => vi.restoreAllMocks());

describe("runMcpInstall", () => {
  it("adds the hooks to exactly the agents the server landed on, and says so", async () => {
    const d = deps(MCP);
    await runMcpInstall([], d);
    expect(d.installAuditHooks).toHaveBeenCalledTimes(1);
    expect(d.installAuditHooks).toHaveBeenCalledWith({ targets: ["claude-code", "cursor"] });
    const text = output.join("\n");
    expect(text).toContain("read-audit and write-audit hooks");
    expect(text).toContain("claude-code  hooks → /home/me/claude-code");
    expect(text).toContain("cursor       hooks → /home/me/cursor");
  });

  it("tells a Codex user to approve the hooks, even ones an earlier install wrote", async () => {
    const d = deps(MCP);
    d.installAuditHooks = vi.fn((): AuditHookResult[] => [
      { target: "codex", name: "Codex", path: "/home/me/.codex/hooks.json", status: "unchanged", added: 0, detail: "" },
    ]);
    await runMcpInstall([], d);
    expect(output.join("\n")).toContain("click Review hooks by the message box and allow the Markbase ones");
  });

  it("says nothing about approval when Codex got no hooks", async () => {
    await runMcpInstall([], deps(MCP));
    expect(output.join("\n")).not.toContain("/hooks");
  });

  it("adds no hooks when the server reached no agent with file tools", async () => {
    const d = deps(MCP.filter((r) => r.target === "desktop"));
    await runMcpInstall(["--desktop"], d);
    expect(d.installAuditHooks).not.toHaveBeenCalled();
    expect(output.join("\n")).not.toContain("hooks");
  });
});
