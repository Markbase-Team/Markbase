import type { AsyncSubagentCompletion } from '../../../core/runtime/subagent';
import type { StreamChunk } from '../../../core/types/chat';

export interface SessionInitEvent {
  type: 'session_init';
  sessionId: string;
  agents?: string[];
  permissionMode?: string;
}

export interface ContextWindowEvent {
  type: 'context_window';
  contextWindow: number;
}

export type ClaudeAsyncSubagentCompletionEvent = AsyncSubagentCompletion;

export type TransformEvent =
  | StreamChunk
  | SessionInitEvent
  | ContextWindowEvent
  | ClaudeAsyncSubagentCompletionEvent;
