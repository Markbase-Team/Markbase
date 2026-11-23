import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { AGENT_TOOLS_PATH } from "@markbase/shared/docs/agent-tools";
import {
  hookAgentsOf,
  installAuditHooks,
  installDocsMcp,
  type AuditHookOptions,
  type AuditHookResult,
  type McpInstallOptions,
  type McpInstallResult,
  type McpTarget,
} from "@markbase/local";
import { canOpenBrowser } from "@markbase/local/flows/node";
import { appUrl, environmentApiKey, loadConfig, savedApiKey } from "../config";
import { agentBrowserLogin, ensureAuthenticated } from "../login";
import type { Json } from "@markbase/shared/endpoint-tools";
import { MCP_INSTRUCTIONS, MCP_PROMPTS } from "@markbase/shared/docs/onboarding";
import { answerMcpLine, clientNameIn, type McpHost } from "@markbase/shared/mcp-http";
import { callEndpoint } from "./call";
import { printHookResults } from "../audit-install";
import { mcpAuth } from "./mcp-auth";
import { toolSource } from "./tool-source";

// `markbase mcp install [--desktop] [--claude-code] [--codex] [--cursor]` — wire
// the doc tools into Claude Desktop, Claude Code, Codex, and/or Cursor. Default:
// all detected. Authenticates first. Every agent that gets the tools and has
// file tools of its own (all but Claude Desktop) also gets the read-audit and
// write-audit hooks, so its direct edits of vault files are attributed to it.

/** What the install touches outside this function; a test hands in fakes. */
export interface McpInstallDeps {
  ensureAuthenticated: () => Promise<boolean>;
  loadConfig: typeof loadConfig;
  savedApiKey: typeof savedApiKey;
  installDocsMcp: (opts: McpInstallOptions) => McpInstallResult[];
  installAuditHooks: (opts: AuditHookOptions) => AuditHookResult[];
}

const LIVE_DEPS: McpInstallDeps = { ensureAuthenticated, loadConfig, savedApiKey, installDocsMcp, installAuditHooks };

export async function runMcpInstall(argv: string[] = [], deps: McpInstallDeps = LIVE_DEPS): Promise<void> {
  await deps.ensureAuthenticated();
  const cfg = deps.loadConfig();
  // The saved key stays where it is: the server reads it when it starts, so
  // one sign-in serves every agent and a new one needs no reinstall. Only a
  // key the server could not find for itself (it came from this command's
  // environment) is written into the agents' configs.
  const key = deps.savedApiKey() ? undefined : cfg.apiKey || undefined;
  const base = process.env.MARKBASE_API_BASE ?? `${appUrl()}/api/v1`;

  // Said BEFORE the ticks, not after them. Wiring the editors with no key is
  // deliberate — the server picks one up whenever it arrives — but a headless
  // machine reaches this line having just been told it cannot sign in, and
  // three green checkmarks underneath that read as "it worked".
  if (!cfg.apiKey) {
    // Deliberately does NOT repeat where to get a key: ensureAuthenticated has
    // just said that, two lines up. This says the one thing it doesn't — what
    // state the tools are left in.
    console.log(
      canOpenBrowser()
        ? "⚠ Not signed in yet. The tools are wired, and the first one an agent\n" +
            "  uses will open your browser to sign in.\n"
        : "⚠ Not signed in yet, so the tools are wired but will not work until\n" +
            "  a key is set. No need to run this again afterwards.\n"
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
  // The same installer the desktop app's Settings runs (@markbase/local).
  const installed = deps.installDocsMcp({ key, base, targets, forceCursor: want.cursor });
  for (const r of installed) {
    const name = r.name.padEnd(15);
    if (r.status === "installed") console.log(`  ✓ ${name} → ${r.detail}`);
    else if (r.status === "skipped") console.log(`  • ${name} — skipped (${r.detail})`);
    else console.log(`  • ${name} — ${r.detail}`);
  }

  // The hooks, for the agents the server just landed on — the same installer
  // `markbase audit install` and the desktop app run, so a second run (or
  // either of those) adds nothing more.
  const hookAgents = hookAgentsOf(installed);
  if (hookAgents.length > 0) {
    console.log("\nAdding the read-audit and write-audit hooks, so a document's history names the agent…\n");
    printHookResults(deps.installAuditHooks({ targets: hookAgents }));
  }

  console.log();
  if (!cfg.apiKey) {
    console.log(
      canOpenBrowser()
        ? "⚠ Not signed in yet — run `markbase login`, or let the first tool call ask."
        : "⚠ Not signed in yet — set MARKBASE_API_KEY in the agent's config."
    );
  }
  console.log("Restart the editor(s) you wired to load the document tools.");
}

// `markbase mcp` — an MCP stdio server that exposes each agent document endpoint as
// a tool. The tools are the server's own list (GET /agent/tools), generated
// there from the registry that drives the routes and the skill.
// Point Claude Desktop at it via claude_desktop_config.json (command: npx -y
// @markbase/cli mcp). It uses the key saved on this machine, or the one in
// MARKBASE_API_KEY when the config names one. humanOnly endpoints are excluded.

function version(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    return JSON.parse(readFileSync(join(here, "../package.json"), "utf8")).version;
  } catch {
    return "0.0.0";
  }
}

/**
 * Ask the server for its tools; null when it has no answer. Listing never
 * signs anyone in: an agent lists tools as it starts, and a browser opening
 * then would be a browser nobody asked for.
 */
async function fetchServedTools(key: string): Promise<string | null> {
  if (!key) return null;
  const base = process.env.MARKBASE_API_BASE ?? `${appUrl()}/api/v1`;
  const res = await fetch(base + AGENT_TOOLS_PATH, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(5_000),
  });
  return res.ok ? res.text() : null;
}

/** The streams the server talks over; a test hands in its own. */
export interface McpStreams {
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
}

/**
 * Serve MCP over a pair of streams: one JSON-RPC message per line in, one per
 * line out. Resolves when the input ends and every answer has been written.
 * Lines are answered as they arrive, not one at a time, so a slow tool call
 * does not hold up a ping behind it.
 */
export async function serveMcpLines(
  host: McpHost,
  streams: McpStreams,
  seen?: (message: Json) => void
): Promise<void> {
  const lines = createInterface({ input: streams.input, crlfDelay: Infinity });
  const pending = new Set<Promise<void>>();
  for await (const line of lines) {
    const answering = answerMcpLine(line, host, seen)
      .then((answer) => {
        if (answer !== null) streams.output.write(`${answer}\n`);
      })
      .catch((err: Error) => {
        // Nothing goes to stdout but protocol; a failure to answer is ours to note.
        process.stderr.write(`markbase mcp: ${err.message}\n`);
      })
      .finally(() => {
        pending.delete(answering);
      });
    pending.add(answering);
  }
  await Promise.all(pending);
}

export async function runMcp(streams: McpStreams = { input: process.stdin, output: process.stdout }): Promise<void> {
  // A sign-in the agent started ends with the agent: the loopback it waits
  // on would otherwise keep this process alive after the agent has gone. The
  // agent going is its end of stdin closing.
  const leaving = new AbortController();
  streams.input.once("end", () => leaving.abort());
  streams.input.once("close", () => leaving.abort());
  const auth = mcpAuth({
    environmentKey: environmentApiKey,
    savedKey: savedApiKey,
    canSignIn: canOpenBrowser,
    signIn: (opened) => agentBrowserLogin(opened, leaving.signal),
  });

  // The connecting client's name, from its `initialize`. Forwarded with every
  // tool call so the API records which tool this is.
  let clientName: string | undefined;

  // The same server the hosted /mcp route runs (@markbase/shared/mcp-http);
  // only the way in differs. Here a message is a line on stdin.
  const host: McpHost = {
    name: "markbase-docs",
    version: version(),
    tools: toolSource(() => fetchServedTools(auth.key())),
    // What the hosted server says too. No cards here: they open documents at
    // an address on the instance, which the hosted server is the one to give.
    instructions: MCP_INSTRUCTIONS,
    prompts: MCP_PROMPTS,
    async call(tool, args) {
      // With a key that works: the one this machine has or, when the API
      // refuses it or there is none, the one a sign-in in the browser gives.
      // When this server is bound to a session via MARKBASE_SESSION_TOKEN, the
      // token goes too, so doc actions attribute to that agent session.
      const r = await auth.call((apiKey) =>
        callEndpoint(tool, args, {
          viaMcp: true,
          clientName,
          sessionToken: process.env.MARKBASE_SESSION_TOKEN,
          apiKey,
        })
      );
      // Thrown, so the agent is told the sign-in message and nothing else.
      if ("needsSignIn" in r) throw new Error(r.needsSignIn);
      return r;
    },
  };

  await serveMcpLines(host, streams, (message) => {
    clientName = clientNameIn(message) ?? clientName;
  });
}
