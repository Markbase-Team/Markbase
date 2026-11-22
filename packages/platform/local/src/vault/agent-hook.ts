import { isAbsolute, resolve } from "node:path";

// Reading what an agent's hook hands over.
//
// Claude Code, Codex and Cursor each run a command around a tool call and give
// it one JSON object on stdin (their docs: code.claude.com/docs/hooks,
// developers.openai.com/codex/hooks, cursor.com/docs/hooks). The shapes
// differ; this turns any of them into one HookCall — who the agent is, whether
// the tool is about to run or has run, and which files it reads or writes —
// which is all `markbase read-audit` and `markbase write-audit` need.
//
// Nothing here touches the disk or knows what a vault is: that is
// agent-audit.ts. A payload this cannot make sense of yields a call with no
// files, which records nothing.

/** Any JSON value — a hook payload is one, of a shape that depends on the agent. */
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

/** One search-and-replace an edit tool reported. */
export interface HookEdit {
  oldText: string;
  newText: string;
  replaceAll: boolean;
}

/** One file a tool call writes. */
export interface HookWrite {
  /** Absolute path. */
  file: string;
  /** The replacements the tool reported, when it reports them (an edit, not a rewrite). */
  edits: HookEdit[] | null;
  /**
   * The file's text before the write, when the tool hands it over: a string,
   * or null for a file that did not exist. Undefined when it says nothing.
   */
  before?: string | null;
}

export interface HookCall {
  /** "claude", "codex", "cursor" — or whatever --agent named. */
  agent: string;
  /** The agent's own id for the conversation, when it gives one. */
  session: string | null;
  /** The hook's event name as the agent spells it (`PostToolUse`, `afterFileEdit`). */
  event: string | null;
  /** Before the tool runs, or after it has. */
  phase: "before" | "after";
  /** The tool as the agent names it (`Read`, `Edit`, `apply_patch`). */
  tool: string | null;
  /** Absolute paths of the files the call reads. */
  reads: string[];
  writes: HookWrite[];
  /**
   * A shell command the call runs, when it is one. Codex reads files with
   * `cat` and `sed`, not a read tool, so the audit looks through the command
   * for files in a vault (agent-audit.ts, shellReads).
   */
  shell: string | null;
  cwd: string;
}

function isObject(value: Json | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: Json | undefined): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Parse a hook's stdin; null when it is not a JSON object. */
export function parseHookPayload(raw: string): JsonObject | null {
  try {
    const value: Json = JSON.parse(raw);
    return isObject(value) ? value : null;
  } catch {
    return null;
  }
}

/** Which agent sent this, from fields only that agent sends. */
export function detectAgent(payload: JsonObject): string {
  if (payload.cursor_version !== undefined || payload.conversation_id !== undefined) return "cursor";
  if (payload.turn_id !== undefined) return "codex";
  if (payload.session_id !== undefined || payload.transcript_path !== undefined) return "claude";
  return "unknown";
}

const BEFORE_EVENTS = new Set([
  "pretooluse",
  "beforereadfile",
  "beforetabfileread",
  "beforeshellexecution",
  "beforemcpexecution",
]);

/** The file paths an `apply_patch` patch touches (Codex's edit tool). */
export function patchFiles(patch: string): string[] {
  const files: string[] = [];
  for (const line of patch.split("\n")) {
    const match = /^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/.exec(line.trimEnd());
    if (match && !files.includes(match[1])) files.push(match[1]);
  }
  return files;
}

function editOf(value: Json | undefined): HookEdit | null {
  if (!isObject(value)) return null;
  const oldText = typeof value.old_string === "string" ? value.old_string : null;
  const newText = typeof value.new_string === "string" ? value.new_string : null;
  if (oldText === null || newText === null) return null;
  return { oldText, newText, replaceAll: value.replace_all === true };
}

function editsOf(value: Json | undefined): HookEdit[] | null {
  if (!Array.isArray(value)) return null;
  const edits = value.map(editOf);
  return edits.every((e): e is HookEdit => e !== null) ? edits : null;
}

/**
 * Turn a hook's payload into a HookCall. `agent` is what --agent named, when
 * it was given; `fallbackCwd` is the hook process's own directory, for a
 * payload that names none.
 */
export function readHookCall(payload: JsonObject, agent: string | null, fallbackCwd: string): HookCall {
  const event = text(payload.hook_event_name);
  const roots = Array.isArray(payload.workspace_roots) ? payload.workspace_roots : [];
  const cwd = text(payload.cwd) ?? text(roots[0]) ?? fallbackCwd;
  const abs = (path: string): string => (isAbsolute(path) ? path : resolve(cwd, path));

  const call: HookCall = {
    agent: agent ?? detectAgent(payload),
    session: text(payload.session_id) ?? text(payload.conversation_id),
    event,
    phase: event !== null && BEFORE_EVENTS.has(event.toLowerCase()) ? "before" : "after",
    tool: text(payload.tool_name),
    reads: [],
    writes: [],
    shell: null,
    cwd,
  };

  const input = isObject(payload.tool_input) ? payload.tool_input : {};
  const response = isObject(payload.tool_response) ? payload.tool_response : {};
  const file = text(payload.file_path) ?? text(input.file_path) ?? text(input.path) ?? text(input.notebook_path);
  const kind = (event ?? "").toLowerCase();
  const tool = (call.tool ?? "").toLowerCase();

  // Cursor's own events carry the file at the top level and name no tool.
  if (kind === "beforereadfile" || kind === "beforetabfileread") {
    if (file) call.reads.push(abs(file));
    return call;
  }
  if (kind === "afterfileedit" || kind === "aftertabfileedit") {
    if (file) call.writes.push({ file: abs(file), edits: editsOf(payload.edits) });
    return call;
  }

  if (tool === "read" || tool === "notebookread") {
    if (file) call.reads.push(abs(file));
    return call;
  }

  if (tool === "edit" || tool === "multiedit" || tool === "write" || tool === "notebookedit") {
    if (!file) return call;
    const one = editOf(input);
    const write: HookWrite = { file: abs(file), edits: one ? [one] : editsOf(input.edits) };
    // Claude Code's result carries the file as it was: a string, or null for a new file.
    if (typeof response.originalFile === "string" || response.originalFile === null) {
      write.before = response.originalFile;
    }
    call.writes.push(write);
    return call;
  }

  const command = Array.isArray(input.command)
    ? input.command.filter((part): part is string => typeof part === "string").join(" ")
    : text(input.command) ?? text(payload.command);

  if (tool === "apply_patch") {
    for (const path of patchFiles(command ?? "")) call.writes.push({ file: abs(path), edits: null });
    return call;
  }

  if (tool === "bash" || tool === "shell" || kind === "beforeshellexecution" || kind === "aftershellexecution") {
    call.shell = command;
  }
  return call;
}
