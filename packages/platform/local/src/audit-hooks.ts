import { spawnSync } from "node:child_process";
import { accessSync, constants, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { isJsonObject, type Json, type JsonObject } from "./json";
import type { McpInstallResult } from "./mcp-install";

// The read-audit and write-audit hooks: what tells an agent's direct edit of a
// vault file from the person's own. Each agent runs `markbase read-audit` and
// `markbase write-audit` around its file tools, and the sync daemon matches a
// file change to a recorded write (agent-audit in @markbase/local/vault). Without the
// hooks every such edit is credited to the person.
//
// One installer for the three places that add hooks — `markbase audit install`,
// `markbase mcp install` and the desktop app at launch — so they can never
// write different hooks. Each agent keeps its hooks in a JSON file of its own
// shape:
//   Claude Code  ~/.claude/settings.json   hooks.<Event>[] of { matcher, hooks[] }
//   Codex        ~/.codex/hooks.json       the same shape
//   Cursor       ~/.cursor/hooks.json      { version, hooks.<event>[] of { command } }
//
// The file is merged, never replaced: other settings and other people's hooks
// stay, and running this twice adds nothing the second time. A file that
// cannot be read as JSON, or cannot be written, is left exactly as it was.

/** The agents that take hooks: the MCP targets minus Claude Desktop, which has no file tools. */
export type HookAgent = "claude-code" | "codex" | "cursor";

export const HOOK_AGENTS: { target: HookAgent; name: string }[] = [
  { target: "claude-code", name: "Claude Code" },
  { target: "codex", name: "Codex" },
  { target: "cursor", name: "Cursor" },
];

export interface AuditHookResult {
  target: HookAgent;
  /** The agent's name, as people know it. */
  name: string;
  /** The config file the hooks live in. */
  path: string;
  /**
   * installed  hooks were added (`added` says how many)
   * unchanged  every hook was already there
   * skipped    the agent is not on this machine, or its file is read-only
   * failed     the file could not be read as JSON, or the write failed
   */
  status: "installed" | "unchanged" | "skipped" | "failed";
  added: number;
  /** Why it was skipped or failed; empty otherwise. */
  detail: string;
}

export interface AuditHookOptions {
  /**
   * Which agents. Named agents get the hooks whether or not their config
   * folder exists (they were asked for); omitted, every agent whose folder is
   * on this machine.
   */
  targets?: HookAgent[];
  /** How a hook runs the CLI; `auditBin()` when omitted. */
  bin?: string;
  /** The home directory; the real one unless a test says otherwise. */
  home?: string;
  /** The environment the `markbase` probe runs in (a desktop app passes withToolPath()). */
  env?: NodeJS.ProcessEnv;
}

type AuditCommand = "read-audit" | "write-audit";

/** Does this hook entry already run one of the audit commands? */
function runsAudit(entry: Json, command: AuditCommand): boolean {
  return JSON.stringify(entry).includes(command);
}

/** One hook to add: which event, which tools, which audit command. */
export interface HookSpec {
  event: string;
  matcher: string;
  audit: AuditCommand;
}

export const CLAUDE_HOOKS: HookSpec[] = [
  { event: "PreToolUse", matcher: "Edit|Write|MultiEdit", audit: "write-audit" },
  { event: "PostToolUse", matcher: "Read", audit: "read-audit" },
  { event: "PostToolUse", matcher: "Edit|Write|MultiEdit", audit: "write-audit" },
];

// Codex edits with apply_patch and reads with shell commands.
export const CODEX_HOOKS: HookSpec[] = [
  { event: "PreToolUse", matcher: "apply_patch", audit: "write-audit" },
  { event: "PostToolUse", matcher: "Bash", audit: "read-audit" },
  { event: "PostToolUse", matcher: "apply_patch", audit: "write-audit" },
];

/**
 * A Claude Code or Codex settings object with the audit hooks merged in.
 * `added` counts the hooks that were not there already.
 */
export function withToolHooks(
  settings: JsonObject,
  specs: HookSpec[],
  agent: string,
  bin: string
): { settings: JsonObject; added: number } {
  const hooks: JsonObject = isJsonObject(settings.hooks) ? { ...settings.hooks } : {};
  let added = 0;
  for (const spec of specs) {
    const existing = hooks[spec.event];
    const entries: Json[] = Array.isArray(existing) ? [...existing] : [];
    const already = entries.some(
      (entry) => isJsonObject(entry) && entry.matcher === spec.matcher && runsAudit(entry, spec.audit)
    );
    if (already) continue;
    entries.push({
      matcher: spec.matcher,
      hooks: [{ type: "command", command: `${bin} ${spec.audit} --agent ${agent}` }],
    });
    hooks[spec.event] = entries;
    added++;
  }
  return { settings: { ...settings, hooks }, added };
}

/** A Cursor hooks.json object with the audit hooks merged in. */
export function withCursorHooks(config: JsonObject, bin: string): { settings: JsonObject; added: number } {
  const hooks: JsonObject = isJsonObject(config.hooks) ? { ...config.hooks } : {};
  let added = 0;
  const specs: { event: string; audit: AuditCommand }[] = [
    { event: "beforeReadFile", audit: "read-audit" },
    { event: "afterFileEdit", audit: "write-audit" },
  ];
  for (const spec of specs) {
    const existing = hooks[spec.event];
    const entries: Json[] = Array.isArray(existing) ? [...existing] : [];
    if (entries.some((entry) => runsAudit(entry, spec.audit))) continue;
    entries.push({ command: `${bin} ${spec.audit} --agent cursor` });
    hooks[spec.event] = entries;
    added++;
  }
  return { settings: { version: 1, ...config, hooks }, added };
}

/**
 * How a hook should call the CLI: by name when `markbase` is installed on the
 * PATH (the hook then starts in a fraction of a second), else through npx.
 * `env` is the environment the probe runs in — a desktop app, started without
 * the shell's PATH, passes withToolPath().
 */
export function auditBin(env: NodeJS.ProcessEnv = process.env): string {
  const found = spawnSync("markbase", ["--version"], { stdio: "ignore", env });
  return !found.error && found.status === 0 ? "markbase" : "npx -y @markbase/cli";
}

/** Read a JSON config file; an absent one is empty, an unreadable one is an error. */
function readConfig(path: string): JsonObject {
  if (!existsSync(path)) return {};
  const value: Json = JSON.parse(readFileSync(path, "utf8"));
  if (!isJsonObject(value)) throw new Error(`${path} is not a JSON object`);
  return value;
}

/** Can the file (or, when it is not there yet, its folder) be written? */
function writable(path: string): boolean {
  let probe = path;
  while (!existsSync(probe)) {
    const parent = dirname(probe);
    if (parent === probe) return false;
    probe = parent;
  }
  try {
    accessSync(probe, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function writeConfig(path: string, settings: JsonObject): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`);
}

interface Target {
  target: HookAgent;
  name: string;
  /** The agent's config folder: the agent is on this machine when it exists. */
  folder: string;
  path: string;
  merge: (settings: JsonObject, bin: string) => { settings: JsonObject; added: number };
}

function targetsIn(home: string): Target[] {
  return [
    {
      target: "claude-code",
      name: "Claude Code",
      folder: join(home, ".claude"),
      path: join(home, ".claude", "settings.json"),
      merge: (settings, bin) => withToolHooks(settings, CLAUDE_HOOKS, "claude", bin),
    },
    {
      target: "codex",
      name: "Codex",
      folder: join(home, ".codex"),
      path: join(home, ".codex", "hooks.json"),
      merge: (settings, bin) => withToolHooks(settings, CODEX_HOOKS, "codex", bin),
    },
    {
      target: "cursor",
      name: "Cursor",
      folder: join(home, ".cursor"),
      path: join(home, ".cursor", "hooks.json"),
      merge: (settings, bin) => withCursorHooks(settings, bin),
    },
  ];
}

/**
 * Add the audit hooks to each agent asked for (or found); one result per
 * agent. Idempotent: a second run reports every agent `unchanged`.
 */
export function installAuditHooks(opts: AuditHookOptions = {}): AuditHookResult[] {
  const home = opts.home ?? homedir();
  const all = targetsIn(home);
  const chosen = opts.targets
    ? all.filter((t) => opts.targets!.includes(t.target))
    : all.filter((t) => existsSync(t.folder));
  if (chosen.length === 0) return [];
  const bin = opts.bin ?? auditBin(opts.env);

  return chosen.map(({ target, name, path, merge }): AuditHookResult => {
    const base = { target, name, path, added: 0, detail: "" };
    try {
      const { settings, added } = merge(readConfig(path), bin);
      if (added === 0) return { ...base, status: "unchanged" };
      if (!writable(path)) return { ...base, status: "skipped", detail: `${path} is read-only` };
      writeConfig(path, settings);
      return { ...base, status: "installed", added };
    } catch (e) {
      return { ...base, status: "failed", detail: e instanceof Error ? e.message : String(e) };
    }
  });
}

/**
 * What an agent asks of the person before it runs hooks it was given. Codex
 * runs a hook from ~/.codex/hooks.json only once the person has approved it in
 * Codex, and approves the exact command: until then the hooks sit in the file
 * and never fire, so its reads and edits go unrecorded.
 */
const APPROVAL: Partial<Record<HookAgent, string>> = {
  codex:
    "Codex runs new hooks only after you approve them: in the Codex app, click Review hooks by the message box and allow the Markbase ones (in the Codex CLI, type /hooks).",
};

/**
 * The approval each agent still needs, one line per agent whose hooks are in
 * place. `unchanged` counts too: hooks written by an earlier install may never
 * have been approved, and nothing here can tell.
 */
export function hookApprovals(results: AuditHookResult[]): string[] {
  return results
    .filter((r) => r.status === "installed" || r.status === "unchanged")
    .map((r) => APPROVAL[r.target])
    .filter((note): note is string => note !== undefined);
}

/**
 * The agents an MCP install just landed on that can take hooks: `markbase mcp
 * install` adds the hooks to exactly these, so an agent that got the document
 * tools also gets its file edits attributed.
 */
export function hookAgentsOf(results: McpInstallResult[]): HookAgent[] {
  const takesHooks = new Set<string>(HOOK_AGENTS.map((a) => a.target));
  return results
    .filter((r) => r.status === "installed" && takesHooks.has(r.target))
    .map((r) => r.target as HookAgent);
}
