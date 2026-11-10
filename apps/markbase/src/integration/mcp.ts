import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { AGENT_ENDPOINTS, type DocEndpoint } from "@markbase/docs/endpoints";
import { appUrl, loadConfig } from "../config";
import { ensureAuthenticated } from "../login";
import { callEndpoint, pathParams } from "./call";

// Where Claude Desktop reads its MCP config, per platform.
function claudeDesktopConfigPath(): string {
  const home = homedir();
  if (process.platform === "darwin") {
    return join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
  }
  if (process.platform === "win32") {
    return join(process.env.APPDATA ?? join(home, "AppData", "Roaming"), "Claude", "claude_desktop_config.json");
  }
  return join(process.env.XDG_CONFIG_HOME ?? join(home, ".config"), "Claude", "claude_desktop_config.json");
}

function serverDef(key: string, base: string) {
  return {
    command: "npx",
    args: ["-y", "@markbase/cli", "mcp"],
    env: { MARKBASE_API_KEY: key, MARKBASE_API_BASE: base },
  };
}

// Cursor reads its global MCP servers from ~/.cursor/mcp.json (same JSON shape
// as Claude Desktop).
function cursorConfigPath(): string {
  return join(homedir(), ".cursor", "mcp.json");
}

// Merge our server into a JSON `mcpServers` config, preserving the others. Shared
// by the editors that read a JSON file directly (Claude Desktop, Cursor).
function installJsonConfig(path: string, key: string, base: string): string {
  let config: { mcpServers?: Record<string, unknown> } = {};
  try {
    config = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    // no config yet, or unreadable — start fresh
  }
  config.mcpServers = config.mcpServers ?? {};
  config.mcpServers["markbase-docs"] = serverDef(key, base);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(config, null, 2) + "\n");
  return path;
}

// Claude Code: use its own CLI so it owns its config (~/.claude.json is large
// and stateful — safer than hand-editing). User scope = available everywhere.
function installClaudeCode(
  key: string,
  base: string
): "ok" | "no-cli" | "failed" {
  const check = spawnSync("claude", ["--version"], { stdio: "ignore" });
  if (check.error || check.status !== 0) return "no-cli";
  // Remove any prior entry so re-running is idempotent, then add.
  spawnSync("claude", ["mcp", "remove", "markbase-docs", "-s", "user"], {
    stdio: "ignore",
  });
  const res = spawnSync(
    "claude",
    [
      "mcp", "add", "markbase-docs", "-s", "user",
      "-e", `MARKBASE_API_KEY=${key}`,
      "-e", `MARKBASE_API_BASE=${base}`,
      "--", "npx", "-y", "@markbase/cli", "mcp",
    ],
    { stdio: "ignore" }
  );
  return res.status === 0 ? "ok" : "failed";
}

// Codex: same idea as Claude Code — let its own CLI own `~/.codex/config.toml`
// rather than hand-editing TOML. `codex mcp add` writes an `[mcp_servers.<name>]`
// entry; NAME comes before the `--` command, and env vars are `--env K=V`.
function installCodex(key: string, base: string): "ok" | "no-cli" | "failed" {
  const check = spawnSync("codex", ["--version"], { stdio: "ignore" });
  if (check.error || check.status !== 0) return "no-cli";
  // Idempotent: drop any prior entry, then add.
  spawnSync("codex", ["mcp", "remove", "markbase-docs"], { stdio: "ignore" });
  const res = spawnSync(
    "codex",
    [
      "mcp", "add",
      "--env", `MARKBASE_API_KEY=${key}`,
      "--env", `MARKBASE_API_BASE=${base}`,
      "markbase-docs",
      "--", "npx", "-y", "@markbase/cli", "mcp",
    ],
    { stdio: "ignore" }
  );
  return res.status === 0 ? "ok" : "failed";
}

// `markbase mcp install [--desktop] [--claude-code] [--codex] [--cursor]` — wire
// the doc tools into Claude Desktop, Claude Code, Codex, and/or Cursor. Default:
// all detected. Authenticates first.
export async function runMcpInstall(argv: string[] = []): Promise<void> {
  await ensureAuthenticated();
  const cfg = loadConfig();
  const key = cfg.apiKey || "jsk_YOUR_KEY";
  const base = process.env.MARKBASE_API_BASE ?? `${appUrl()}/api/v1`;

  // Said BEFORE the ticks, not after them. Writing the placeholder config is
  // deliberate — you can wire your editors now and paste a key in later — but a
  // headless machine reaches this line having just been told it cannot sign in,
  // and three green checkmarks underneath that read as "it worked".
  if (!cfg.apiKey) {
    // Deliberately does NOT repeat where to get a key: ensureAuthenticated has
    // just said that, two lines up. This says the one thing it doesn't — what
    // the files below actually contain.
    console.log(
      "⚠ No key yet, so the files below get a placeholder and the tools will\n" +
        "  401 until a real key replaces it.\n"
    );
    // An installer or CI step reads the exit code, and until a real key is in
    // place this did not do what was asked.
    process.exitCode = 1;
  }

  // No target flag = do everything; a flag = only the ones named.
  const want = {
    desktop: argv.includes("--desktop"),
    code: argv.includes("--claude-code"),
    codex: argv.includes("--codex"),
    cursor: argv.includes("--cursor"),
  };
  const any = want.desktop || want.code || want.codex || want.cursor;
  const doDesktop = !any || want.desktop;
  const doCode = !any || want.code;
  const doCodex = !any || want.codex;
  const doCursor = !any || want.cursor;

  console.log("Installing the markbase-docs MCP server…\n");
  if (doDesktop) {
    console.log(`  ✓ Claude Desktop  → ${installJsonConfig(claudeDesktopConfigPath(), key, base)}`);
  }
  if (doCode) {
    const r = installClaudeCode(key, base);
    if (r === "ok") console.log("  ✓ Claude Code     → user scope (claude mcp add)");
    else if (r === "no-cli") console.log("  • Claude Code     — skipped ('claude' CLI not on PATH)");
    else console.log("  • Claude Code     — 'claude mcp add' failed");
  }
  if (doCodex) {
    const r = installCodex(key, base);
    if (r === "ok") console.log("  ✓ Codex           → global (codex mcp add)");
    else if (r === "no-cli") console.log("  • Codex           — skipped ('codex' CLI not on PATH)");
    else console.log("  • Codex           — 'codex mcp add' failed");
  }
  if (doCursor) {
    // Only auto-write into ~/.cursor when Cursor is actually present (no CLI to
    // probe like the others), unless it was asked for explicitly.
    if (want.cursor || existsSync(join(homedir(), ".cursor"))) {
      console.log(`  ✓ Cursor          → ${installJsonConfig(cursorConfigPath(), key, base)}`);
    } else {
      console.log("  • Cursor          — skipped (~/.cursor not found)");
    }
  }

  console.log();
  if (!cfg.apiKey) {
    console.log("⚠ No key yet — create one in the dashboard → API keys, then re-run.");
  }
  console.log("Restart the editor(s) you wired to load the document tools.");
}

// `markbase mcp` — an MCP stdio server that exposes each agent document endpoint as
// a tool, generated from the same registry that drives the routes/skill/CLI.
// Point Claude Desktop at it via claude_desktop_config.json (command: npx -y
// @markbase/cli mcp; env: MARKBASE_API_KEY). humanOnly endpoints are excluded.

function version(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    return JSON.parse(readFileSync(join(here, "../package.json"), "utf8")).version;
  } catch {
    return "0.0.0";
  }
}

// JSON Schema for a tool: path params (required strings) + declared params.
function inputSchema(e: DocEndpoint): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const name of pathParams(e.path)) {
    properties[name] = { type: "string", description: "path parameter" };
    required.push(name);
  }
  for (const p of e.params ?? []) {
    properties[p.name] =
      p.type === "json"
        ? { description: p.description ?? "JSON value" }
        : { type: p.type, description: p.description };
    if (p.required) required.push(p.name);
  }
  return { type: "object", properties, required };
}

export async function runMcp(): Promise<void> {
  const server = new Server(
    { name: "markbase-docs", version: version() },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: AGENT_ENDPOINTS.map((e) => ({
      name: e.id,
      description: e.skill ? `${e.summary} — ${e.skill.whenToUse}` : e.summary,
      inputSchema: inputSchema(e),
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const e = AGENT_ENDPOINTS.find((x) => x.id === req.params.name);
    if (!e) {
      return {
        isError: true,
        content: [{ type: "text", text: `Unknown tool: ${req.params.name}` }],
      };
    }
    try {
      // Forward the connecting client's name (from the MCP initialize handshake)
      // so the API records which provider this is, and — when this server is
      // bound to a session via MARKBASE_SESSION_TOKEN — the session token so doc
      // actions attribute to that agent session.
      const r = await callEndpoint(
        e,
        (req.params.arguments ?? {}) as Record<string, unknown>,
        {
          clientName: server.getClientVersion()?.name,
          sessionToken: process.env.MARKBASE_SESSION_TOKEN,
        }
      );
      let text = r.body;
      try {
        text = JSON.stringify(JSON.parse(r.body), null, 2);
      } catch {
        // not JSON
      }
      return {
        isError: !r.ok,
        content: [
          { type: "text", text: r.ok ? text : `HTTP ${r.status}\n${text}` },
        ],
      };
    } catch (err) {
      return {
        isError: true,
        content: [
          { type: "text", text: err instanceof Error ? err.message : String(err) },
        ],
      };
    }
  });

  await server.connect(new StdioServerTransport());
  // stdio server runs until the transport closes; nothing else to do.
}
