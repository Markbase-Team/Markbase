// @markbase/agent — a provider-neutral runtime for embedding coding agents
// as a native chat. Both providers (claude now, codex later) normalize their
// streams to the shared StreamChunk model, so the UI never branches on provider.
//
// Portions ported from Claudian (https://github.com/YishenTu/claudian), MIT —
// see NOTICE. This first slice is the Claude message model: SDK message → chunks.

export {
  transformSDKMessage,
  createTransformStreamState,
  createTransformUsageState,
} from "./providers/claude/stream/transformClaudeMessage";
export type {
  TransformOptions,
  TransformUsageState,
} from "./providers/claude/stream/transformClaudeMessage";
export type { TransformEvent } from "./providers/claude/sdk/types";

// The shared, provider-neutral render contract.
export type { StreamChunk, UsageInfo } from "./core/types/chat";

// Persisted sessions: the `.chat/` index (doc links + title) plus reading the
// SDK's transcript (the source of truth for messages) back into ChatTurns.
export type { ChatSessionMeta, ChatBlock, ChatTurn } from "./sessions/types";
export {
  saveChatSession,
  getChatSession,
  listChatSessions,
  deleteChatSession,
} from "./sessions/chatStore";
export { readTranscript, parseTranscript, findTranscriptFile } from "./sessions/transcript";

// Reading a failure out of a chunk stream — including the ones the CLI reports
// as ordinary assistant text (see failure.ts).
export { failureIn } from "./core/failure";
export { explainFailure, type Explained } from "./core/explain";
export { CliExitedError } from "./providers/claude/runtime/cliExitWatch";
export { openClaudeSession } from "./providers/claude/runtime/claudeSession";
export type {
  ClaudeSession,
  ClaudeSessionParams,
  SessionEvent,
} from "./providers/claude/runtime/claudeSession";
