import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { AGENT_ENDPOINTS, type DocEndpoint } from "@markbase/docs/endpoints";
import { installDocsMcp, type McpTarget } from "@markbase/node";
import { appUrl, loadConfig } from "../config";
import { ensureAuthenticated } from "../login";
import { callEndpoint, pathParams } from "./call";

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
  const targets: McpTarget[] = [];
  if (doDesktop) targets.push("desktop");
  if (doCode) targets.push("claude-code");
  if (doCodex) targets.push("codex");
  if (doCursor) targets.push("cursor");
  // The same installer the desktop app's Settings runs (@markbase/node).
  for (const r of installDocsMcp({ key, base, targets, forceCursor: want.cursor })) {
    const name = r.name.padEnd(15);
    if (r.status === "installed") console.log(`  ✓ ${name} → ${r.detail}`);
    else if (r.status === "skipped") console.log(`  • ${name} — skipped (${r.detail})`);
    else console.log(`  • ${name} — ${r.detail}`);
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
