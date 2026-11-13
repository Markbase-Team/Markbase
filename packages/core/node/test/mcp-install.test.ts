import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import {
  DOCS_MCP_SERVER,
  claudeDesktopConfigPath,
  installDocsMcp,
  withDocsMcp,
  withToolPath,
} from "../src/mcp-install";

// The installer writes into config files people already keep other servers
// in, from the CLI and from the desktop app. These pin the merge, the files
// it writes on a real temporary home, and the PATH the app looks tools up on.

const KEY = "jsk_test";
const BASE = "https://markbase.example/api/v1";

describe("withDocsMcp", () => {
  it("sets our server and keeps every other entry and setting", () => {
    const merged = withDocsMcp({ theme: "dark", mcpServers: { other: { command: "x" } } }, KEY, BASE);
    expect(merged).toEqual({
      theme: "dark",
      mcpServers: {
        other: { command: "x" },
        [DOCS_MCP_SERVER]: {
          command: "npx",
          args: ["-y", "@markbase/cli", "mcp"],
          env: { MARKBASE_API_KEY: KEY, MARKBASE_API_BASE: BASE },
        },
      },
    });
  });

  it("replaces an earlier entry of ours, so a new key takes", () => {
    const first = withDocsMcp({}, "jsk_old", BASE);
    const second = withDocsMcp(first, KEY, BASE);
    expect(JSON.stringify(second)).not.toContain("jsk_old");
  });
});

describe("installDocsMcp", () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "markbase-mcp-"));
  });
  afterEach(() => rmSync(home, { recursive: true, force: true }));

  it("writes Claude Desktop's config, merged with what is there", () => {
    const path = claudeDesktopConfigPath(home);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, JSON.stringify({ mcpServers: { other: { command: "x" } } }));

    const [result] = installDocsMcp({ key: KEY, base: BASE, targets: ["desktop"], home });
    expect(result).toMatchObject({ target: "desktop", name: "Claude Desktop", status: "installed", detail: path });
    const written = JSON.parse(readFileSync(path, "utf8"));
    expect(Object.keys(written.mcpServers).sort()).toEqual(["markbase-docs", "other"]);
  });

  it("skips Cursor when it is not on the machine, unless asked for by name", () => {
    expect(installDocsMcp({ key: KEY, base: BASE, targets: ["cursor"], home })[0]).toMatchObject({
      status: "skipped",
      detail: "~/.cursor not found",
    });
    const [forced] = installDocsMcp({ key: KEY, base: BASE, targets: ["cursor"], forceCursor: true, home });
    expect(forced.status).toBe("installed");
    expect(readFileSync(join(home, ".cursor", "mcp.json"), "utf8")).toContain(DOCS_MCP_SERVER);
  });

  it("skips an agent whose own CLI is not installed", () => {
    // A PATH with nothing on it: neither `claude` nor `codex` can be found.
    const results = installDocsMcp({
      key: KEY,
      base: BASE,
      targets: ["claude-code", "codex"],
      home,
      env: { PATH: join(home, "empty") },
    });
    expect(results.map((r) => [r.name, r.status])).toEqual([
      ["Claude Code", "skipped"],
      ["Codex", "skipped"],
    ]);
  });
});

describe("withToolPath", () => {
  it("adds the usual install locations after what is already there, once", () => {
    const env = withToolPath({ PATH: ["/usr/bin", "/opt/homebrew/bin"].join(delimiter) }, "/Users/me");
    const dirs = (env.PATH ?? "").split(delimiter);
    expect(dirs.slice(0, 2)).toEqual(["/usr/bin", "/opt/homebrew/bin"]);
    expect(dirs.filter((d) => d === "/opt/homebrew/bin")).toHaveLength(1);
    expect(dirs).toContain("/usr/local/bin");
    expect(dirs).toContain("/Users/me/.local/bin");
  });
});
