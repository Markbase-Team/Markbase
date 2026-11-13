import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { markbaseHome } from "./markbase-home";
import { readMountedVaults, type MountedVault } from "./vault-registry";
import type { HookCall, HookEdit, HookWrite } from "./agent-hook";
import { changeTotals, textChanges, type TextChange } from "./text-changes";

// The audit of what agents read and write in mounted vaults.
//
// The sync daemon sees that a file changed and never who changed it: an agent
// writing a vault file looks exactly like its owner typing. The agents can
// say, though — each runs a hook command around its tool calls — so `markbase
// read-audit` and `markbase write-audit` are those commands, and this is what
// they record:
//
//   reads.jsonl   one line per file an agent read: which agent, which file;
//   writes.jsonl  one line per file an agent wrote: which agent, which file,
//                 and exactly which characters it removed and inserted.
//
// Both live in <markbase home>/audit, on this machine only, one JSON object
// per line so a later reader (a report, the desktop app, a human score) can
// take them a line at a time. writes.jsonl holds document text, so the
// directory is 0700 and the files 0600.
//
// A file outside every mounted vault is none of this ledger's business and
// records nothing; so does a file under a dot-directory (.conflicts, .trash,
// .git), which is not a document.
//
// "Exactly which characters" needs the file as it was before the write. In
// order of trust: a snapshot taken by the same command at the agent's
// before-the-tool hook; the original the tool itself hands back (Claude
// Code); the tool's own search-and-replace pairs, undone against the file as
// it is now (Claude Code, Cursor). With none of those the write is still
// recorded, with `changes: null` — who and which file, not which characters.

/** One file an agent read. */
export interface ReadEvent {
  v: 1;
  at: string;
  agent: string;
  session: string | null;
  tool: string | null;
  vaultId: string;
  vault: string;
  /** The file's path inside the vault, with forward slashes. */
  path: string;
  /** Present when the read was found in a shell command, not reported by a read tool. */
  inferred?: true;
}

/** Where a write's "before" text came from; "none" when there was nothing to compare with. */
export type WriteBaseline = "snapshot" | "tool" | "edits" | "none";

/** One file an agent wrote. */
export interface WriteEvent {
  v: 1;
  at: string;
  agent: string;
  session: string | null;
  tool: string | null;
  vaultId: string;
  vault: string;
  path: string;
  baseline: WriteBaseline;
  /** The characters removed and inserted, in order; null when the baseline is "none". */
  changes: TextChange[] | null;
  /** Characters inserted and removed in all; null when the changes are. */
  inserted: number | null;
  removed: number | null;
}

/** A file inside a mounted vault. */
export interface VaultFile {
  vaultId: string;
  vault: string;
  path: string;
}

export function auditDir(): string {
  return join(markbaseHome(), "audit");
}

export function readsLedgerPath(): string {
  return join(auditDir(), "reads.jsonl");
}

export function writesLedgerPath(): string {
  return join(auditDir(), "writes.jsonl");
}

function pendingDir(): string {
  return join(auditDir(), "pending");
}

/** The real path of a file that may not exist yet: its nearest existing ancestor's, plus the rest. */
function realPath(path: string): string {
  let existing = path;
  const rest: string[] = [];
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) return path;
    rest.unshift(basename(existing));
    existing = parent;
  }
  try {
    return join(realpathSync(existing), ...rest);
  } catch {
    return path;
  }
}

/** The vault a file belongs to and its path inside it; null when it is in none, or hidden. */
export function findVaultFile(file: string, vaults: MountedVault[] = readMountedVaults()): VaultFile | null {
  const real = realPath(resolve(file));
  for (const vault of vaults) {
    const inside = relative(realPath(resolve(vault.dir)), real);
    if (inside === "" || inside.startsWith("..") || isAbsolute(inside)) continue;
    const parts = inside.split(sep);
    if (parts.some((part) => part.startsWith("."))) return null;
    return { vaultId: vault.vaultId, vault: vault.name, path: parts.join("/") };
  }
  return null;
}

function append(path: string, event: ReadEvent | WriteEvent): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  appendFileSync(path, `${JSON.stringify(event)}\n`, { mode: 0o600 });
}

/**
 * The files a shell command names that exist inside a vault — how a read by
 * an agent with no read tool (Codex runs `cat` and `sed`) is found. A guess
 * by construction: a command that names a file does not have to read it.
 */
export function shellReads(command: string, cwd: string, vaults: MountedVault[]): string[] {
  const files: string[] = [];
  const words = command.match(/"[^"]*"|'[^']*'|[^\s|;&<>()]+/g) ?? [];
  for (const word of words) {
    const bare = word.replace(/^["']|["']$/g, "");
    if (!bare || bare.startsWith("-")) continue;
    const path = isAbsolute(bare) ? bare : resolve(cwd, bare);
    try {
      if (!statSync(path).isFile()) continue;
    } catch {
      continue;
    }
    if (findVaultFile(path, vaults) && !files.includes(path)) files.push(path);
  }
  return files;
}

/** Record every vault file a call reads. Returns what was recorded. */
export function recordReads(
  call: HookCall,
  vaults: MountedVault[] = readMountedVaults(),
  now: Date = new Date()
): ReadEvent[] {
  const events: ReadEvent[] = [];
  const add = (file: string, inferred: boolean): void => {
    const found = findVaultFile(file, vaults);
    if (!found) return;
    events.push({
      v: 1,
      at: now.toISOString(),
      agent: call.agent,
      session: call.session,
      tool: call.tool,
      ...found,
      ...(inferred ? { inferred: true as const } : {}),
    });
  };
  for (const file of call.reads) add(file, false);
  if (call.shell) for (const file of shellReads(call.shell, call.cwd, vaults)) add(file, true);
  for (const event of events) append(readsLedgerPath(), event);
  return events;
}

/** A file as it was at the agent's before-the-tool hook. */
interface Snapshot {
  file: string;
  at: number;
  /** Null when the file did not exist. */
  content: string | null;
}

/** A snapshot older than this was left by a tool call that never finished; not a baseline. */
const SNAPSHOT_MAX_AGE_MS = 10 * 60 * 1000;

function snapshotPath(file: string): string {
  return join(pendingDir(), `${createHash("sha256").update(realPath(resolve(file))).digest("hex")}.json`);
}

function readFileOrNull(file: string): string | null {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

/** Before a write: keep each vault file as it is now, for the after-hook to compare with. */
export function snapshotWrites(
  call: HookCall,
  vaults: MountedVault[] = readMountedVaults(),
  now: Date = new Date()
): number {
  let kept = 0;
  for (const write of call.writes) {
    if (!findVaultFile(write.file, vaults)) continue;
    const snapshot: Snapshot = { file: write.file, at: now.getTime(), content: readFileOrNull(write.file) };
    mkdirSync(pendingDir(), { recursive: true, mode: 0o700 });
    writeFileSync(snapshotPath(write.file), JSON.stringify(snapshot), { mode: 0o600 });
    kept++;
  }
  return kept;
}

function takeSnapshot(file: string, now: Date): Snapshot | null {
  const path = snapshotPath(file);
  const raw = readFileOrNull(path);
  if (raw === null) return null;
  rmSync(path, { force: true });
  try {
    const snapshot: Snapshot = JSON.parse(raw);
    return now.getTime() - snapshot.at <= SNAPSHOT_MAX_AGE_MS ? snapshot : null;
  } catch {
    return null;
  }
}

/**
 * The text before a set of search-and-replace edits, worked back from the text
 * after them: each edit undone, last first. Null when an edit's replacement is
 * not in the text to undo.
 */
export function undoEdits(after: string, edits: HookEdit[]): string | null {
  let text = after;
  for (const edit of [...edits].reverse()) {
    if (edit.replaceAll) {
      if (edit.newText === "") return null;
      text = text.split(edit.newText).join(edit.oldText);
      continue;
    }
    const at = text.indexOf(edit.newText);
    if (at === -1) return null;
    text = text.slice(0, at) + edit.oldText + text.slice(at + edit.newText.length);
  }
  return text;
}

function baselineOf(
  write: HookWrite,
  after: string,
  now: Date
): { baseline: WriteBaseline; before: string | null } {
  const snapshot = takeSnapshot(write.file, now);
  if (snapshot) return { baseline: "snapshot", before: snapshot.content ?? "" };
  if (write.before !== undefined) return { baseline: "tool", before: write.before ?? "" };
  if (write.edits && write.edits.length > 0) {
    const before = undoEdits(after, write.edits);
    if (before !== null) return { baseline: "edits", before };
  }
  return { baseline: "none", before: null };
}

/** After a write: record, for every vault file the call wrote, which characters changed. */
export function recordWrites(
  call: HookCall,
  vaults: MountedVault[] = readMountedVaults(),
  now: Date = new Date()
): WriteEvent[] {
  const events: WriteEvent[] = [];
  for (const write of call.writes) {
    const found = findVaultFile(write.file, vaults);
    if (!found) continue;
    // A deleted file reads as empty: everything it held was removed.
    const after = readFileOrNull(write.file) ?? "";
    const { baseline, before } = baselineOf(write, after, now);
    const changes = before === null ? null : textChanges(before, after);
    // A write that changed nothing is not a write.
    if (changes !== null && changes.length === 0) continue;
    const totals = changes === null ? null : changeTotals(changes);
    events.push({
      v: 1,
      at: now.toISOString(),
      agent: call.agent,
      session: call.session,
      tool: call.tool,
      ...found,
      baseline,
      changes,
      inserted: totals ? totals.inserted : null,
      removed: totals ? totals.removed : null,
    });
  }
  for (const event of events) append(writesLedgerPath(), event);
  return events;
}

function readLedger<T extends ReadEvent | WriteEvent>(path: string): T[] {
  const raw = readFileOrNull(path);
  if (raw === null) return [];
  const events: T[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const event: T = JSON.parse(line);
      events.push(event);
    } catch {
      // A line cut short by a crash mid-append; the rest of the ledger stands.
    }
  }
  return events;
}

export function readReadEvents(): ReadEvent[] {
  return readLedger<ReadEvent>(readsLedgerPath());
}

export function readWriteEvents(): WriteEvent[] {
  return readLedger<WriteEvent>(writesLedgerPath());
}

/** How often each file was read, in all and by each agent. */
export interface ReadCount {
  vaultId: string;
  vault: string;
  path: string;
  total: number;
  byAgent: Record<string, number>;
  lastAt: string;
}

/** Read counts per file, most-read first. */
export function countReads(events: ReadEvent[]): ReadCount[] {
  const counts = new Map<string, ReadCount>();
  for (const e of events) {
    const key = `${e.vaultId}\n${e.path}`;
    const count = counts.get(key) ?? {
      vaultId: e.vaultId,
      vault: e.vault,
      path: e.path,
      total: 0,
      byAgent: {},
      lastAt: e.at,
    };
    count.total++;
    count.byAgent[e.agent] = (count.byAgent[e.agent] ?? 0) + 1;
    if (e.at > count.lastAt) count.lastAt = e.at;
    counts.set(key, count);
  }
  return [...counts.values()].sort((a, b) => b.total - a.total || a.path.localeCompare(b.path));
}

/** What each agent wrote to a file, in all. */
export interface WriteCount {
  vaultId: string;
  vault: string;
  path: string;
  writes: number;
  byAgent: Record<string, { writes: number; inserted: number; removed: number; unmeasured: number }>;
  lastAt: string;
}

/** Write totals per file, most-written first. */
export function countWrites(events: WriteEvent[]): WriteCount[] {
  const counts = new Map<string, WriteCount>();
  for (const e of events) {
    const key = `${e.vaultId}\n${e.path}`;
    const count = counts.get(key) ?? {
      vaultId: e.vaultId,
      vault: e.vault,
      path: e.path,
      writes: 0,
      byAgent: {},
      lastAt: e.at,
    };
    const agent = count.byAgent[e.agent] ?? { writes: 0, inserted: 0, removed: 0, unmeasured: 0 };
    count.writes++;
    agent.writes++;
    agent.inserted += e.inserted ?? 0;
    agent.removed += e.removed ?? 0;
    if (e.changes === null) agent.unmeasured++;
    count.byAgent[e.agent] = agent;
    if (e.at > count.lastAt) count.lastAt = e.at;
    counts.set(key, count);
  }
  return [...counts.values()].sort((a, b) => b.writes - a.writes || a.path.localeCompare(b.path));
}
