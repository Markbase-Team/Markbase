import { describe, it, expect } from "vitest";
import { detectAgent, parseHookPayload, patchFiles, readHookCall, type Json } from "../src/agent-hook";

// One HookCall out of three agents' payloads. The payloads are the shapes
// their docs give (Claude Code and Codex: PreToolUse/PostToolUse with
// tool_name and tool_input; Cursor: beforeReadFile and afterFileEdit with the
// file at the top level).

function call(payload: { [key: string]: Json }, agent: string | null = null) {
  return readHookCall(payload, agent, "/fallback");
}

describe("Claude Code", () => {
  const base = { session_id: "s1", transcript_path: "/t.jsonl", cwd: "/repo" };

  it("reads a Read", () => {
    const c = call({ ...base, hook_event_name: "PostToolUse", tool_name: "Read", tool_input: { file_path: "/v/a.md" } });
    expect(c).toMatchObject({ agent: "claude", session: "s1", phase: "after", tool: "Read", reads: ["/v/a.md"] });
    expect(c.writes).toEqual([]);
  });

  it("reads an Edit, with its replacement and the original the tool returns", () => {
    const c = call({
      ...base,
      hook_event_name: "PostToolUse",
      tool_name: "Edit",
      tool_input: { file_path: "notes/a.md", old_string: "Monday", new_string: "Friday" },
      tool_response: { filePath: "/repo/notes/a.md", originalFile: "Ship on Monday." },
    });
    expect(c.writes).toEqual([
      {
        file: "/repo/notes/a.md",
        edits: [{ oldText: "Monday", newText: "Friday", replaceAll: false }],
        before: "Ship on Monday.",
      },
    ]);
  });

  it("reads a Write of a new file: no edits, and an original of null", () => {
    const c = call({
      ...base,
      hook_event_name: "PostToolUse",
      tool_name: "Write",
      tool_input: { file_path: "/v/new.md", content: "hi" },
      tool_response: { type: "create", originalFile: null },
    });
    expect(c.writes).toEqual([{ file: "/v/new.md", edits: null, before: null }]);
  });

  it("knows a PreToolUse is before the tool", () => {
    const c = call({ ...base, hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path: "/v/a.md" } });
    expect(c.phase).toBe("before");
    expect(c.writes[0].before).toBeUndefined();
  });
});

describe("Codex", () => {
  const base = { session_id: "s2", turn_id: "t1", cwd: "/repo", model: "gpt" };
  const patch = [
    "*** Begin Patch",
    "*** Update File: docs/plan.md",
    "@@",
    "-old",
    "+new",
    "*** Add File: docs/new.md",
    "+hello",
    "*** End Patch",
  ].join("\n");

  it("is told apart by its turn id", () => {
    expect(detectAgent(base)).toBe("codex");
  });

  it("reads the files an apply_patch touches", () => {
    expect(patchFiles(patch)).toEqual(["docs/plan.md", "docs/new.md"]);
    const c = call({ ...base, hook_event_name: "PostToolUse", tool_name: "apply_patch", tool_input: { command: patch } });
    expect(c.writes).toEqual([
      { file: "/repo/docs/plan.md", edits: null },
      { file: "/repo/docs/new.md", edits: null },
    ]);
  });

  it("hands a shell command on, for the audit to look for files in", () => {
    const c = call({ ...base, hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "cat docs/plan.md" } });
    expect(c.shell).toBe("cat docs/plan.md");
    expect(c.reads).toEqual([]);
  });
});

describe("Cursor", () => {
  const base = { conversation_id: "c1", cursor_version: "2.0", workspace_roots: ["/ws"] };

  it("reads a beforeReadFile as a read, before the tool", () => {
    const c = call({ ...base, hook_event_name: "beforeReadFile", file_path: "/ws/a.md", content: "x" });
    expect(c).toMatchObject({ agent: "cursor", session: "c1", phase: "before", reads: ["/ws/a.md"], cwd: "/ws" });
  });

  it("reads an afterFileEdit with its edits", () => {
    const c = call({
      ...base,
      hook_event_name: "afterFileEdit",
      file_path: "/ws/a.md",
      edits: [{ old_string: "a", new_string: "b" }],
    });
    expect(c.phase).toBe("after");
    expect(c.writes).toEqual([{ file: "/ws/a.md", edits: [{ oldText: "a", newText: "b", replaceAll: false }] }]);
  });
});

describe("anything else", () => {
  it("--agent wins over what the payload looks like", () => {
    expect(call({ session_id: "s", hook_event_name: "PostToolUse", tool_name: "Read", tool_input: { file_path: "/a" } }, "aider").agent).toBe("aider");
  });

  it("makes a call with no files out of a payload it cannot read", () => {
    const c = call({ something: "else" });
    expect(c).toMatchObject({ agent: "unknown", reads: [], writes: [], shell: null, cwd: "/fallback" });
  });

  it("refuses stdin that is not a JSON object", () => {
    expect(parseHookPayload("")).toBeNull();
    expect(parseHookPayload("[1]")).toBeNull();
    expect(parseHookPayload("not json")).toBeNull();
    expect(parseHookPayload('{"a":1}')).toEqual({ a: 1 });
  });
});
