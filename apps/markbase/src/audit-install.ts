import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { Json } from "@markbase/vault";

// `markbase audit install` — add the read-audit and write-audit hooks to the
// agents on this machine, so what they read and write in a vault is on record
// and a document's history can say an agent wrote a version.
//
// Each agent keeps its hooks in a JSON file of its own shape:
//   Claude Code  ~/.claude/settings.json   hooks.<Event>[] of { matcher, hooks[] }
//   Codex        ~/.codex/hooks.json       the same shape
//   Cursor       ~/.cursor/hooks.json      { version, hooks.<event>[] of { command } }
//
// The file is merged, never replaced: other settings and other people's hooks
// stay, and running this twice adds nothing the second time.

type JsonObject = { [key: string]: Json };

function isObject(value: Json | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Does this hook entry already run one of the audit commands? */
function runsAudit(entry: Json, command: "read-audit" | "write-audit"): boolean {
  return JSON.stringify(entry).includes(command);
}

/** One hook to add: which event, which tools, which audit command. */
interface HookSpec {
  event: string;
  matcher: string;
  audit: "read-audit" | "write-audit";
}

const CLAUDE_HOOKS: HookSpec[] = [
  { event: "PreToolUse", matcher: "Edit|Write|MultiEdit", audit: "write-audit" },
  { event: "PostToolUse", matcher: "Read", audit: "read-audit" },
  { event: "PostToolUse", matcher: "Edit|Write|MultiEdit", audit: "write-audit" },
];

// Codex edits with apply_patch and reads with shell commands.
const CODEX_HOOKS: HookSpec[] = [
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
  const hooks: JsonObject = isObject(settings.hooks) ? { ...settings.hooks } : {};
  let added = 0;
  for (const spec of specs) {
    const existing = hooks[spec.event];
    const entries: Json[] = Array.isArray(existing) ? [...existing] : [];
    const already = entries.some(
      (entry) => isObject(entry) && entry.matcher === spec.matcher && runsAudit(entry, spec.audit)
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
  const hooks: JsonObject = isObject(config.hooks) ? { ...config.hooks } : {};
  let added = 0;
  const specs: { event: string; audit: "read-audit" | "write-audit" }[] = [
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

/** Read a JSON config file; an absent one is empty, an unreadable one is an error. */
function readConfig(path: string): JsonObject {
  if (!existsSync(path)) return {};
  const value: Json = JSON.parse(readFileSync(path, "utf8"));
  if (!isObject(value)) throw new Error(`${path} is not a JSON object`);
  return value;
}

function writeConfig(path: string, settings: JsonObject): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`);
}

/**
 * How a hook should call this CLI: by name when `markbase` is installed on the
 * PATH (the hook then starts in a fraction of a second), else through npx.
 */
export function auditBin(): string {
  const found = spawnSync("markbase", ["--version"], { stdio: "ignore" });
  return found.status === 0 ? "markbase" : "npx -y @markbase/cli";
}

interface Target {
  flag: string;
  name: string;
  path: string;
  /** The agent is on this machine when its config folder exists. */
  present: () => boolean;
  merge: (settings: JsonObject, bin: string) => { settings: JsonObject; added: number };
}

function targets(home: string = homedir()): Target[] {
  return [
    {
      flag: "--claude-code",
      name: "Claude Code",
      path: join(home, ".claude", "settings.json"),
      present: () => existsSync(join(home, ".claude")),
      merge: (settings, bin) => withToolHooks(settings, CLAUDE_HOOKS, "claude", bin),
    },
    {
      flag: "--codex",
      name: "Codex",
      path: join(home, ".codex", "hooks.json"),
      present: () => existsSync(join(home, ".codex")),
      merge: (settings, bin) => withToolHooks(settings, CODEX_HOOKS, "codex", bin),
    },
    {
      flag: "--cursor",
      name: "Cursor",
      path: join(home, ".cursor", "hooks.json"),
      present: () => existsSync(join(home, ".cursor")),
      merge: (settings, bin) => withCursorHooks(settings, bin),
    },
  ];
}

const HELP = `markbase audit install — add the read-audit and write-audit hooks to your agents.

  markbase audit install                 every agent found on this machine
  markbase audit install --claude-code   only the ones named
                         --codex
                         --cursor

Then:  markbase read-audit report   and   markbase write-audit report
`;

export async function runAudit(argv: string[]): Promise<void> {
  if (argv[0] !== "install") {
    console.log(HELP);
    if (argv[0] !== undefined && argv[0] !== "help" && argv[0] !== "--help") process.exitCode = 1;
    return;
  }
  const all = targets();
  const named = all.filter((t) => argv.includes(t.flag));
  const chosen = named.length > 0 ? named : all.filter((t) => t.present());
  if (chosen.length === 0) {
    console.log("No agent found on this machine (looked for ~/.claude, ~/.codex and ~/.cursor).");
    return;
  }
  const bin = auditBin();
  for (const target of chosen) {
    try {
      const { settings, added } = target.merge(readConfig(target.path), bin);
      if (added === 0) {
        console.log(`  • ${target.name.padEnd(12)} already set up (${target.path})`);
        continue;
      }
      writeConfig(target.path, settings);
      console.log(`  ✓ ${target.name.padEnd(12)} → ${target.path}`);
    } catch (e) {
      console.log(`  ✗ ${target.name.padEnd(12)} ${e instanceof Error ? e.message : String(e)}`);
      process.exitCode = 1;
    }
  }
  console.log("\nRestart the agent so it picks the hooks up. Codex asks you to review new hooks (/hooks).");
}
