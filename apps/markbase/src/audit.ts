import { appendFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  auditDir,
  countReads,
  countWrites,
  parseHookPayload,
  readHookCall,
  readReadEvents,
  readWriteEvents,
  recordReads,
  recordWrites,
  snapshotWrites,
  type HookCall,
  type ReadEvent,
  type WriteEvent,
} from "@markbase/vault";

// `markbase read-audit` and `markbase write-audit`: the commands an agent's
// hook runs, so that what agents read and write in a mounted vault is on
// record (the ledger and its rules are @markbase/vault's agent-audit.ts).
//
// Run by a hook, each takes the hook's JSON on stdin and says nothing — an
// agent shows a hook's output to the model or the person, and a hook that
// fails can block the tool it wraps. So a hook run never exits non-zero and
// never prints, with one exception: Cursor's before-hooks wait for an answer,
// and get "allow". A failure goes to <markbase home>/audit/errors.log.
//
// Run by a person, `report` reads the ledger back.

const READ_HELP = `markbase read-audit — record which agent read which vault file.

As an agent hook (reads the hook's JSON on stdin, prints nothing):
  markbase read-audit --agent claude|codex|cursor

By hand:
  markbase read-audit --agent <name> --file <path>
  markbase read-audit report [--json] [--file <path>]
`;

const WRITE_HELP = `markbase write-audit — record which agent changed which characters of which vault file.

As an agent hook (reads the hook's JSON on stdin, prints nothing). Run it both
before and after the edit tool: the "before" run keeps the file as it was, so
the "after" run can tell exactly which characters changed.
  markbase write-audit --agent claude|codex|cursor

By hand:
  markbase write-audit --agent <name> --file <path> --before     keep the file as it is
  markbase write-audit --agent <name> --file <path>              record what changed since
  markbase write-audit report [--json] [--file <path>]
`;

interface AuditArgs {
  agent: string | null;
  file: string | null;
  before: boolean;
  json: boolean;
  report: boolean;
  help: boolean;
}

export function parseAuditArgs(argv: string[]): AuditArgs {
  const args: AuditArgs = { agent: null, file: null, before: false, json: false, report: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "report") args.report = true;
    else if (arg === "--before") args.before = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "-h" || arg === "--help" || arg === "help") args.help = true;
    else if (arg === "--agent") args.agent = argv[++i] ?? null;
    else if (arg.startsWith("--agent=")) args.agent = arg.slice("--agent=".length);
    else if (arg === "--file") args.file = argv[++i] ?? null;
    else if (arg.startsWith("--file=")) args.file = arg.slice("--file=".length);
  }
  return args;
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function logError(command: string, error: Error): void {
  try {
    mkdirSync(auditDir(), { recursive: true, mode: 0o700 });
    appendFileSync(
      join(auditDir(), "errors.log"),
      `${new Date().toISOString()} ${command}: ${error.stack ?? error.message}\n`,
      { mode: 0o600 }
    );
  } catch {
    // Nowhere to say it; the hook still must not fail the agent's tool.
  }
}

/** The call a person described with --file, in place of a hook's payload. */
function manualCall(args: AuditArgs, kind: "read" | "write"): HookCall {
  const file = resolve(args.file ?? "");
  return {
    agent: args.agent ?? "unknown",
    session: null,
    event: null,
    phase: args.before ? "before" : "after",
    tool: null,
    reads: kind === "read" ? [file] : [],
    writes: kind === "write" ? [{ file, edits: null }] : [],
    shell: null,
    cwd: process.cwd(),
  };
}

/** The call to record: from --file, else from the hook's stdin; null when there is neither. */
async function callFrom(args: AuditArgs, kind: "read" | "write"): Promise<HookCall | null> {
  if (args.file) return manualCall(args, kind);
  const payload = parseHookPayload(await readStdin());
  return payload ? readHookCall(payload, args.agent, process.cwd()) : null;
}

/** Cursor's before-hooks hold the tool until the hook answers; this one never objects. */
function answerCursor(call: HookCall): void {
  if (call.agent === "cursor" && call.phase === "before") {
    process.stdout.write(`${JSON.stringify({ permission: "allow" })}\n`);
  }
}

function agents(byAgent: Record<string, number>): string {
  return Object.entries(byAgent)
    .sort((a, b) => b[1] - a[1])
    .map(([agent, n]) => `${agent} ${n}`)
    .join(", ");
}

function matchesFile(event: ReadEvent | WriteEvent, file: string | null): boolean {
  if (!file) return true;
  return event.path === file || resolve(file).endsWith(`/${event.path}`);
}

function reportReads(args: AuditArgs): void {
  const events = readReadEvents().filter((e) => matchesFile(e, args.file));
  const counts = countReads(events);
  if (args.json) {
    console.log(JSON.stringify(counts, null, 2));
    return;
  }
  if (counts.length === 0) {
    console.log("No agent reads recorded yet.");
    return;
  }
  for (const c of counts) {
    console.log(`${String(c.total).padStart(5)}  ${c.vault}/${c.path}  (${agents(c.byAgent)})`);
  }
}

/** A change's text on one line, long runs cut in the middle. */
function shown(text: string): string {
  const flat = JSON.stringify(text);
  return flat.length <= 80 ? flat : `${flat.slice(0, 50)}…${flat.slice(-25)}`;
}

function reportWrites(args: AuditArgs): void {
  const events = readWriteEvents().filter((e) => matchesFile(e, args.file));
  if (args.json) {
    console.log(JSON.stringify(args.file ? events : countWrites(events), null, 2));
    return;
  }
  if (events.length === 0) {
    console.log("No agent writes recorded yet.");
    return;
  }
  if (!args.file) {
    for (const c of countWrites(events)) {
      const by = Object.entries(c.byAgent)
        .map(([agent, t]) => {
          const unmeasured = t.unmeasured > 0 ? `, ${t.unmeasured} unmeasured` : "";
          return `${agent} ${t.writes} (+${t.inserted} −${t.removed} chars${unmeasured})`;
        })
        .join(", ");
      console.log(`${String(c.writes).padStart(5)}  ${c.vault}/${c.path}  ${by}`);
    }
    console.log("\nmarkbase write-audit report --file <path> shows each change.");
    return;
  }
  // One file: every write, and every run of characters it changed.
  for (const e of events) {
    const size = e.changes === null ? "changes not measured" : `+${e.inserted} −${e.removed} chars`;
    console.log(`${e.at}  ${e.agent}  ${e.vault}/${e.path}  ${size}`);
    for (const change of e.changes ?? []) {
      if (change.removed) console.log(`    at ${change.oldStart}  removed  ${shown(change.removed)}`);
      if (change.inserted) console.log(`    at ${change.newStart}  inserted ${shown(change.inserted)}`);
    }
  }
}

export async function runReadAudit(argv: string[]): Promise<void> {
  const args = parseAuditArgs(argv);
  if (args.help) return void console.log(READ_HELP);
  if (args.report) return reportReads(args);
  try {
    const call = await callFrom(args, "read");
    if (!call) return;
    recordReads(call);
    answerCursor(call);
  } catch (e) {
    logError("read-audit", e instanceof Error ? e : new Error(String(e)));
  }
}

export async function runWriteAudit(argv: string[]): Promise<void> {
  const args = parseAuditArgs(argv);
  if (args.help) return void console.log(WRITE_HELP);
  if (args.report) return reportWrites(args);
  try {
    const call = await callFrom(args, "write");
    if (!call) return;
    if (call.phase === "before") snapshotWrites(call);
    else recordWrites(call);
    answerCursor(call);
  } catch (e) {
    logError("write-audit", e instanceof Error ? e : new Error(String(e)));
  }
}
