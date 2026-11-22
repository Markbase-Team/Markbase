// Read a Claude Code session transcript — the source of truth for a conversation's
// messages — and render it into the shared ChatTurn model the dock uses live.
//
// The SDK writes one JSON-per-line file at
//   ~/.claude/projects/<cwd with "/" → "-">/<sessionId>.jsonl
// with `user` / `assistant` lines (plus meta lines we ignore). We parse the main
// chain only; rewind/fork chains are a later concern. Unknown line types and
// unparseable lines are skipped, so a format drift degrades to "less shown", never
// a crash.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ChatBlock, ChatTurn } from "./types";

/** A content block as it appears inside a transcript message. */
interface RawBlock {
  type?: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  is_error?: boolean;
  content?: string | RawBlock[];
}

/** One line of the .jsonl (only the fields we read). */
interface TranscriptLine {
  type?: string;
  isSidechain?: boolean;
  message?: { role?: string; content?: string | RawBlock[] };
}

type ToolBlock = Extract<ChatBlock, { kind: "tool" }>;

/** Locate a session's transcript. Tries the encoded-cwd path, then falls back to a
 *  scan (the cwd→folder encoding can vary), returning null if it's truly absent. */
export function findTranscriptFile(cwd: string, sessionId: string): string | null {
  const projects = join(homedir(), ".claude", "projects");
  const direct = join(projects, cwd.replace(/\//g, "-"), `${sessionId}.jsonl`);
  if (existsSync(direct)) return direct;
  if (!existsSync(projects)) return null;
  for (const project of readdirSync(projects)) {
    const candidate = join(projects, project, `${sessionId}.jsonl`);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** Flatten a tool_result's content (string, or an array of text parts) to text. */
function toolResultText(content: string | RawBlock[] | undefined): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((c) => (c.type === "text" ? c.text ?? "" : "")).join("");
  return "";
}

/**
 * Read and render a session's transcript, or null if no transcript exists (so the
 * caller can show the metadata and disable resume).
 */
export function readTranscript(cwd: string, sessionId: string): ChatTurn[] | null {
  const file = findTranscriptFile(cwd, sessionId);
  if (!file) return null;
  try {
    return parseTranscript(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Render raw .jsonl transcript text into turns. Consecutive same-role lines merge
 * into one turn; tool results attach to their tool_use by id; meta/unknown lines
 * are skipped. Pure, so it's testable without the filesystem.
 */
export function parseTranscript(raw: string): ChatTurn[] {
  const turns: ChatTurn[] = [];
  const toolById = new Map<string, ToolBlock>();
  let seq = 0;
  const append = (role: "user" | "assistant", blocks: ChatBlock[]): void => {
    if (blocks.length === 0) return;
    const last = turns[turns.length - 1];
    if (last && last.role === role) last.blocks.push(...blocks);
    else turns.push({ id: `t${++seq}`, role, blocks });
  };

  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let entry: TranscriptLine;
    try {
      entry = JSON.parse(line) as TranscriptLine;
    } catch {
      continue;
    }
    if (entry.isSidechain) continue; // subagent side-chains: not the main thread
    const content = entry.message?.content;

    if (entry.type === "user" && content !== undefined) {
      const blocks: ChatBlock[] = [];
      if (typeof content === "string") {
        if (content.trim()) blocks.push({ kind: "text", text: content });
      } else {
        for (const c of content) {
          if (c.type === "text" && c.text && c.text.trim()) {
            blocks.push({ kind: "text", text: c.text });
          } else if (c.type === "tool_result" && c.tool_use_id) {
            const tool = toolById.get(c.tool_use_id);
            if (tool) {
              tool.result = (tool.result ?? "") + toolResultText(c.content);
              if (c.is_error) tool.isError = true;
            }
          }
        }
      }
      // A tool-result-only user line adds no blocks → no user turn (correct: it's
      // machinery, not something the human said).
      append("user", blocks);
    } else if (entry.type === "assistant" && Array.isArray(content)) {
      const blocks: ChatBlock[] = [];
      for (const c of content) {
        if (c.type === "text" && c.text) {
          blocks.push({ kind: "text", text: c.text });
        } else if (c.type === "thinking" && c.thinking) {
          blocks.push({ kind: "thinking", text: c.thinking });
        } else if (c.type === "tool_use" && c.id) {
          const tool: ToolBlock = { kind: "tool", id: c.id, name: c.name ?? "tool", input: c.input ?? {} };
          blocks.push(tool);
          toolById.set(c.id, tool);
        }
      }
      append("assistant", blocks);
    }
  }
  return turns;
}
