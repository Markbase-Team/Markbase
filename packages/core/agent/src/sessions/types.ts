// Persisted agent-chat sessions — the INDEX only.
//
// A conversation started in the dock is a real Claude Code session: the SDK owns
// the transcript and writes it to ~/.claude/projects/<enc-cwd>/<sessionId>.jsonl,
// exactly where the `claude` CLI keeps it. That file is the single source of truth
// for the MESSAGES. We don't duplicate it. What the SDK doesn't know is how a
// conversation relates to a vault document — so THAT (and a title for the history
// list) is all we store, one small JSON file per session under the vault's hidden
// `.chat/` folder. Messages are read back from the .jsonl on reopen (see transcript.ts).

/**
 * The index record we own, one file per conversation (`.chat/<id>.json`).
 *
 * Following Claudian, `id` (ours, stable) is kept SEPARATE from `sessionId` (the
 * Claude resume handle, which can change across resume/reset): the record survives
 * even when the provider mints a new session id. `sessionId` is what we resume with
 * and also names the transcript (`~/.claude/.../<sessionId>.jsonl`).
 */
export interface ChatSessionMeta {
  /** Our stable id — the record key and filename. */
  id: string;
  /** The Claude session id: the resume handle + transcript name. May change. */
  sessionId: string;
  vaultId: string;
  /** Docs this conversation is attached to — the session→doc half of the link. */
  docIds: string[];
  title: string;
  createdAt: string;
  updatedAt: string;
  /** First user message, truncated — shown in the history list. */
  preview: string;
}

/** One rendered block within a turn — the shared render model for both the live
 *  stream (the dock) and the transcript reader. Mirrors the dock's Block exactly. */
export type ChatBlock =
  | { kind: "text"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "tool"; id: string; name: string; input: Record<string, unknown>; result?: string; isError?: boolean }
  | { kind: "error"; text: string }
  | { kind: "notice"; text: string; level?: "info" | "warning" };

/** One user or assistant turn. */
export type ChatTurn = { id: string; role: "user" | "assistant"; blocks: ChatBlock[] };
