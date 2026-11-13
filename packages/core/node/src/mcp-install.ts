import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";

// Connecting the Markbase docs MCP server to the agents on this machine:
// Claude Desktop, Claude Code, Codex and Cursor.
//
// One implementation for both things that offer it — `markbase mcp install`
// in the CLI and "Connect agents" in the desktop app's Settings — so the two
// can never write different configs. Each agent gets a server named
// `markbase-docs` that runs `npx -y @markbase/cli mcp` with the API key and
// base URL in its environment:
//
//   Claude Desktop  its claude_desktop_config.json (merged, other servers kept)
//   Cursor          ~/.cursor/mcp.json (the same shape)
//   Claude Code     `claude mcp add`, so it owns its own large config file
//   Codex           `codex mcp add`, the same reason
//
// Running it again replaces the entry, so it is safe to repeat (a new key,
// another instance).

export const DOCS_MCP_SERVER = "markbase-docs";

export type McpTarget = "desktop" | "claude-code" | "codex" | "cursor";

export const MCP_TARGETS: { target: McpTarget; name: string }[] = [
  { target: "desktop", name: "Claude Desktop" },
  { target: "claude-code", name: "Claude Code" },
  { target: "codex", name: "Codex" },
  { target: "cursor", name: "Cursor" },
];

export interface McpInstallResult {
  target: McpTarget;
  /** The agent's name, as people know it. */
  name: string;
  status: "installed" | "skipped" | "failed";
  /** Where it was written, or why it was not. */
  detail: string;
}

export interface McpInstallOptions {
  /** The API key the server will use. */
  key: string;
  /** The API's base URL, ending in /api/v1. */
  base: string;
  /** Which agents; all of them when omitted. */
  targets?: McpTarget[];
  /** Install for Cursor even when ~/.cursor is not there (it was asked for by name). */
  forceCursor?: boolean;
  /** The home directory; the real one unless a test says otherwise. */
  home?: string;
  /**
   * The environment `claude` and `codex` are looked up and run in. A desktop
   * app is started without the shell's PATH, so it passes one that has the
   * usual install locations (see withToolPath).
   */
  env?: NodeJS.ProcessEnv;
}

/** Any JSON value — an agent's config file is one, mostly not ours. */
type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

function isObject(value: Json | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The server entry every JSON-configured agent gets. */
export function docsMcpServer(key: string, base: string): JsonObject {
  return {
    command: "npx",
    args: ["-y", "@markbase/cli", "mcp"],
    env: { MARKBASE_API_KEY: key, MARKBASE_API_BASE: base },
  };
}

/** A JSON `mcpServers` config with our server set, and every other entry kept. */
export function withDocsMcp(config: JsonObject, key: string, base: string): JsonObject {
  const servers = isObject(config.mcpServers) ? config.mcpServers : {};
  return { ...config, mcpServers: { ...servers, [DOCS_MCP_SERVER]: docsMcpServer(key, base) } };
}

/** Where Claude Desktop reads its MCP config, per platform. */
export function claudeDesktopConfigPath(home: string = homedir()): string {
  if (process.platform === "darwin") {
    return join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
  }
  if (process.platform === "win32") {
    return join(process.env.APPDATA ?? join(home, "AppData", "Roaming"), "Claude", "claude_desktop_config.json");
  }
  return join(process.env.XDG_CONFIG_HOME ?? join(home, ".config"), "Claude", "claude_desktop_config.json");
}

function installJsonConfig(path: string, key: string, base: string): string {
  let config: JsonObject = {};
  try {
    const parsed: Json = JSON.parse(readFileSync(path, "utf8"));
    if (isObject(parsed)) config = parsed;
  } catch {
    // no config yet, or unreadable — start fresh
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(withDocsMcp(config, key, base), null, 2)}\n`);
  return path;
}

/**
 * An environment whose PATH also has the places `claude`, `codex` and `npx`
 * are usually installed — for a process (a desktop app) that was not started
 * from a shell and so never got the user's own PATH.
 */
export function withToolPath(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): NodeJS.ProcessEnv {
  const extra = [
    "/opt/homebrew/bin",
    "/usr/local/bin",
    join(home, ".local", "bin"),
    join(home, ".claude", "local"),
    join(home, ".npm-global", "bin"),
    join(home, ".bun", "bin"),
    join(home, ".volta", "bin"),
  ];
  const have = (env.PATH ?? "").split(delimiter).filter(Boolean);
  return { ...env, PATH: [...have, ...extra.filter((dir) => !have.includes(dir))].join(delimiter) };
}

/** Add the server through an agent's own CLI, which then owns its config file. */
function installWithCli(
  cli: "claude" | "codex",
  add: string[],
  remove: string[],
  env: NodeJS.ProcessEnv
): { status: "installed" | "skipped" | "failed"; detail: string } {
  const check = spawnSync(cli, ["--version"], { stdio: "ignore", env });
  if (check.error || check.status !== 0) return { status: "skipped", detail: `'${cli}' is not installed` };
  // Drop any earlier entry so running again replaces it.
  spawnSync(cli, remove, { stdio: "ignore", env });
  const res = spawnSync(cli, add, { stdio: "ignore", env });
  return res.status === 0
    ? { status: "installed", detail: `${cli} mcp add` }
    : { status: "failed", detail: `'${cli} mcp add' failed` };
}

/** Connect the docs MCP server to each agent asked for; one result per agent. */
export function installDocsMcp(opts: McpInstallOptions): McpInstallResult[] {
  const { key, base } = opts;
  const home = opts.home ?? homedir();
  const env = opts.env ?? process.env;
  const wanted = opts.targets ?? MCP_TARGETS.map((t) => t.target);
  const run = "npx -y @markbase/cli mcp".split(" ");

  return MCP_TARGETS.filter((t) => wanted.includes(t.target)).map(({ target, name }): McpInstallResult => {
    try {
      if (target === "desktop") {
        return { target, name, status: "installed", detail: installJsonConfig(claudeDesktopConfigPath(home), key, base) };
      }
      if (target === "cursor") {
        // No CLI to probe, so only write into ~/.cursor when Cursor is there.
        if (!opts.forceCursor && !existsSync(join(home, ".cursor"))) {
          return { target, name, status: "skipped", detail: "~/.cursor not found" };
        }
        return { target, name, status: "installed", detail: installJsonConfig(join(home, ".cursor", "mcp.json"), key, base) };
      }
      if (target === "claude-code") {
        const add = [
          "mcp", "add", DOCS_MCP_SERVER, "-s", "user",
          "-e", `MARKBASE_API_KEY=${key}`,
          "-e", `MARKBASE_API_BASE=${base}`,
          "--", ...run,
        ];
        return { target, name, ...installWithCli("claude", add, ["mcp", "remove", DOCS_MCP_SERVER, "-s", "user"], env) };
      }
      // Codex: NAME comes before the `--` command, and env vars are `--env K=V`.
      const add = [
        "mcp", "add",
        "--env", `MARKBASE_API_KEY=${key}`,
        "--env", `MARKBASE_API_BASE=${base}`,
        DOCS_MCP_SERVER,
        "--", ...run,
      ];
      return { target, name, ...installWithCli("codex", add, ["mcp", "remove", DOCS_MCP_SERVER], env) };
    } catch (e) {
      return { target, name, status: "failed", detail: e instanceof Error ? e.message : String(e) };
    }
  });
}
