import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CLAUDE_HOOKS, hookAgentsOf, installAuditHooks, withCursorHooks, withToolHooks } from "../src/audit-hooks";
import type { McpInstallResult } from "../src/mcp-install";

// The installer merges into files people already keep settings and hooks in,
// from three callers (audit install, mcp install, the desktop app at launch).
// These pin that it adds what is missing, keeps what is there, adds nothing
// the second time, and leaves a file it cannot read or write exactly as it was.

const BIN = "markbase";

describe("withToolHooks", () => {
  it("adds the hooks to empty settings", () => {
    const { settings, added } = withToolHooks({}, CLAUDE_HOOKS, "claude", BIN);
    expect(added).toBe(3);
    expect(settings).toEqual({
      hooks: {
        PreToolUse: [
          {
            matcher: "Edit|Write|MultiEdit",
            hooks: [{ type: "command", command: "markbase write-audit --agent claude" }],
          },
        ],
        PostToolUse: [
          { matcher: "Read", hooks: [{ type: "command", command: "markbase read-audit --agent claude" }] },
          {
            matcher: "Edit|Write|MultiEdit",
            hooks: [{ type: "command", command: "markbase write-audit --agent claude" }],
          },
        ],
      },
    });
  });

  it("keeps other settings and other hooks, and adds nothing twice", () => {
    const mine = {
      model: "opus",
      hooks: { PostToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "./lint.sh" }] }] },
    };
    const first = withToolHooks(mine, CLAUDE_HOOKS, "claude", BIN);
    expect(first.settings.model).toBe("opus");
    expect(JSON.stringify(first.settings.hooks)).toContain("./lint.sh");

    const second = withToolHooks(first.settings, CLAUDE_HOOKS, "claude", "npx -y @markbase/cli");
    expect(second.added).toBe(0);
    expect(second.settings).toEqual(first.settings);
  });
});

describe("withCursorHooks", () => {
  it("adds both hooks with the version Cursor wants, once", () => {
    const first = withCursorHooks({ hooks: { stop: [{ command: "./done.sh" }] } }, BIN);
    expect(first.added).toBe(2);
    expect(first.settings).toEqual({
      version: 1,
      hooks: {
        stop: [{ command: "./done.sh" }],
        beforeReadFile: [{ command: "markbase read-audit --agent cursor" }],
        afterFileEdit: [{ command: "markbase write-audit --agent cursor" }],
      },
    });
    expect(withCursorHooks(first.settings, BIN).added).toBe(0);
  });
});

describe("installAuditHooks", () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "markbase-hooks-"));
  });
  afterEach(() => {
    // A read-only file from the test below would otherwise survive the rm.
    for (const dir of [".claude", ".codex", ".cursor"]) {
      try {
        chmodSync(join(home, dir), 0o700);
      } catch {
        // not there
      }
    }
    rmSync(home, { recursive: true, force: true });
  });

  it("without targets, installs only for the agents whose folder is there, and once", () => {
    mkdirSync(join(home, ".claude"));
    mkdirSync(join(home, ".cursor"));

    const first = installAuditHooks({ home, bin: BIN });
    expect(first.map((r) => [r.target, r.status, r.added])).toEqual([
      ["claude-code", "installed", 3],
      ["cursor", "installed", 2],
    ]);
    const claude = JSON.parse(readFileSync(join(home, ".claude", "settings.json"), "utf8"));
    expect(Object.keys(claude.hooks).sort()).toEqual(["PostToolUse", "PreToolUse"]);
    const cursor = JSON.parse(readFileSync(join(home, ".cursor", "hooks.json"), "utf8"));
    expect(cursor.version).toBe(1);

    const second = installAuditHooks({ home, bin: BIN });
    expect(second.map((r) => r.status)).toEqual(["unchanged", "unchanged"]);
  });

  it("a named agent gets the hooks even when its folder is not there yet", () => {
    const [codex] = installAuditHooks({ home, bin: BIN, targets: ["codex"] });
    expect(codex).toMatchObject({ target: "codex", status: "installed", added: 3 });
    const written = JSON.parse(readFileSync(join(home, ".codex", "hooks.json"), "utf8"));
    expect(JSON.stringify(written)).toContain("apply_patch");
  });

  it("merges into existing settings and keeps what is there", () => {
    mkdirSync(join(home, ".claude"));
    const path = join(home, ".claude", "settings.json");
    writeFileSync(path, JSON.stringify({ model: "opus", permissions: { allow: ["Bash(ls)"] } }));

    const [claude] = installAuditHooks({ home, bin: BIN, targets: ["claude-code"] });
    expect(claude.status).toBe("installed");
    const written = JSON.parse(readFileSync(path, "utf8"));
    expect(written.model).toBe("opus");
    expect(written.permissions).toEqual({ allow: ["Bash(ls)"] });
    expect(written.hooks.PostToolUse).toHaveLength(2);
  });

  it("leaves a file it cannot parse exactly as it was, and says so", () => {
    mkdirSync(join(home, ".codex"));
    const path = join(home, ".codex", "hooks.json");
    writeFileSync(path, "{ not json");

    const [codex] = installAuditHooks({ home, bin: BIN });
    expect(codex.status).toBe("failed");
    expect(codex.detail).not.toBe("");
    expect(readFileSync(path, "utf8")).toBe("{ not json");
  });

  it("skips a read-only file instead of failing on it", () => {
    if (process.getuid?.() === 0) return; // root writes anything
    mkdirSync(join(home, ".cursor"));
    const path = join(home, ".cursor", "hooks.json");
    writeFileSync(path, JSON.stringify({ hooks: {} }));
    chmodSync(path, 0o444);

    const [cursor] = installAuditHooks({ home, bin: BIN });
    expect(cursor).toMatchObject({ target: "cursor", status: "skipped" });
    expect(cursor.detail).toContain("read-only");
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ hooks: {} });
  });

  it("returns nothing when no agent is on the machine", () => {
    expect(installAuditHooks({ home, bin: BIN })).toEqual([]);
  });
});

describe("hookAgentsOf", () => {
  it("is the agents the MCP server landed on, minus Claude Desktop", () => {
    const results: McpInstallResult[] = [
      { target: "desktop", name: "Claude Desktop", status: "installed", detail: "/x" },
      { target: "claude-code", name: "Claude Code", status: "installed", detail: "claude mcp add" },
      { target: "codex", name: "Codex", status: "skipped", detail: "'codex' is not installed" },
      { target: "cursor", name: "Cursor", status: "installed", detail: "/y" },
    ];
    expect(hookAgentsOf(results)).toEqual(["claude-code", "cursor"]);
    expect(hookAgentsOf([])).toEqual([]);
  });
});
