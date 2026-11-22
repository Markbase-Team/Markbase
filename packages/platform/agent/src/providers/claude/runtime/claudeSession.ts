// A Claude CLI session that outlives a single turn.
//
// This used to be one-shot: start a CLI, run one exchange, let the process exit. That is fine until something is supposed to survive the end
// of a turn — and two things are. A background command is a child of that
// process, so it dies with it: a waiter told to poll CI forty times managed one
// poll before the turn ended and took it with it. And the SDK's way of telling
// the model that something finished needs a session to tell, which by then there
// is not one of.
//
// Streaming input mode is the other half of the same API: hand `query` an async
// iterable instead of a string and the CLI reads from it for as long as the
// session lives. One process per conversation rather than one per message —
// which is also why the control requests the SDK documents as "only supported
// when streaming input is used" (interrupt, setPermissionMode) become available.
//
// The transcript is still the CLI's, still resumable, still on disk. What
// changes is that the process holding it stays up between your messages.

import type { Options, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { getEnhancedPath } from "../../../utils/env";
import type { StreamChunk } from "../../../core/types/chat";
import { loadClaudeAgentQuery } from "../loadClaudeAgentSdk";
import { isStreamChunk } from "../sdk/typeGuards";
import {
  createTransformStreamState,
  createTransformUsageState,
  transformSDKMessage,
} from "../stream/transformClaudeMessage";
import { createCustomSpawnFunction } from "./customSpawn";
import { watchForEarlyExit, CliExitedError, type ExitWatch } from "./cliExitWatch";
import { MessageQueue } from "./messageQueue";

/**
 * The part of the SDK's Query a session actually uses.
 *
 * Named so the session can be built over a stand-in: everything below this line
 * is our logic — turn boundaries, the interrupt latch, what a dead CLI means —
 * and none of it should need a real `claude` process to test.
 */
export interface SessionStream extends AsyncGenerator<SDKMessage, void> {
  interrupt?(): Promise<unknown>;
}

/** The user messages a session writes to the CLI's stdin. */
export interface SessionInput {
  type: "user";
  session_id: string;
  message: { role: "user"; content: Array<{ type: "text"; text: string }> };
  parent_tool_use_id: null;
}

/** What a session reports, in order. */
export type SessionEvent =
  /** A piece of the answer — text, a tool call, usage. */
  | { kind: "chunk"; chunk: StreamChunk }
  /** The CLI finished the exchange it was on. Another may follow. */
  | { kind: "turn-end" };

export interface ClaudeSessionParams {
  /** Working directory — the vault's local folder. */
  cwd: string;
  /** Resume a prior conversation by its provider session id. */
  resume?: string;
  /** Which `claude` to run; a host that ships the binary must say. */
  pathToClaudeCodeExecutable?: string;
  /** Model id (e.g. "sonnet"); omit for the account default. */
  model?: string;
  permissionMode?: Options["permissionMode"];
}

export interface ClaudeSession {
  /**
   * Queue a message. It runs when the CLI reaches it, so sending during a turn
   * is allowed and is how a follow-up is asked without waiting.
   */
  send(prompt: string): void;
  /** Stop the turn in flight. The session stays open for the next message. */
  interrupt(): Promise<void>;
  /** End the session, and the process with it. */
  close(): void;
  /** Everything the session produces, until it is closed or the CLI dies. */
  events(): AsyncGenerator<SessionEvent>;
  /** The provider's id for this conversation, once it has said. */
  providerSessionId(): string | null;
}

export async function openClaudeSession(
  params: ClaudeSessionParams
): Promise<ClaudeSession> {
  const query = await loadClaudeAgentQuery();
  const enhancedPath = getEnhancedPath();

  // A session ends when this queue does — that is what closes the CLI's stdin
  // and lets the process exit, which is the only orderly way to end one.
  const input = new MessageQueue<SessionInput>();
  const exitWatch = watchForEarlyExit({ aborted: () => input.closed });

  const options: Options = {
    cwd: params.cwd,
    includePartialMessages: true,
    permissionMode: params.permissionMode ?? "bypassPermissions",
    env: { ...process.env, PATH: enhancedPath } as Record<string, string>,
    spawnClaudeCodeProcess: createCustomSpawnFunction(enhancedPath, exitWatch.noteExit),
    ...(params.model ? { model: params.model } : {}),
    ...(params.resume ? { resume: params.resume } : {}),
    ...(params.pathToClaudeCodeExecutable
      ? { pathToClaudeCodeExecutable: params.pathToClaudeCodeExecutable }
      : {}),
  };

  return sessionOver(query({ prompt: input, options }), input, exitWatch, params.model);
}

/**
 * The session itself, over a stream that is already running.
 *
 * Split from starting the CLI so the behaviour can be tested against a
 * stand-in stream: a turn boundary, a stop the user asked for, a process that
 * died mid-answer. Exported for that reason.
 */
export function sessionOver(
  stream: SessionStream,
  input: MessageQueue<SessionInput>,
  exitWatch: ExitWatch,
  model?: string
): ClaudeSession {
  let providerId: string | null = null;
  /**
   * A stop the user asked for is landing.
   *
   * An interrupt ends the turn with a `result` whose subtype is
   * `error_during_execution`, and the transform treats every subtype but
   * `success` as an error — so without this, pressing Esc printed an error into
   * the conversation every single time. Whatever the CLI says on its way down is
   * the sound of a deliberate stop, not a failure. Cleared at the turn boundary,
   * which is where the stop finishes arriving.
   */
  let stopping = false;
  /**
   * The last failure already shown in the conversation.
   *
   * The SDK reports one failure twice. A `result` carrying errors is enqueued —
   * we turn it into an error chunk — and then, when the stream ends, its catch
   * REPLACES the exit error with `Claude Code returned an error result: <that
   * same text>` and throws it at the reader. Left alone, one dropped connection
   * became two notices saying the same thing, the second one fatal.
   */
  let lastReported: string | null = null;

  const transformOptions = {
    intendedModel: model,
    streamState: createTransformStreamState(),
    usageState: createTransformUsageState(),
  };
  // Block types the streamed `stream_event` deltas already deliver incrementally.
  const STREAMED_CONTENT = new Set(["text", "thinking", "tool_use", "subagent_tool_use"]);

  async function* events(): AsyncGenerator<SessionEvent> {
    try {
      for (;;) {
        // Raced against the CLI dying, because a dead process does not end the
        // stream: its reader can wait forever on a pipe that no one will close.
        const step = await Promise.race([stream.next(), exitWatch.died]);
        if (step.done) return;
        const message = step.value;

        // Snapshot BEFORE clearing: the interrupt's own `result` is the message
        // carrying the error to suppress, so clearing first would let exactly
        // the one chunk this exists for through.
        const silenced = stopping;
        if (message.type === "result") stopping = false;
        const dropStreamedContent = message.type === "assistant";
        for (const event of transformSDKMessage(message, transformOptions)) {
          if (event.type === "session_init") {
            providerId = event.sessionId;
            continue;
          }
          if (!isStreamChunk(event)) continue;
          if (silenced) continue;
          if (dropStreamedContent && STREAMED_CONTENT.has(event.type)) continue;
          if (event.type === "usage" && providerId && event.sessionId == null) {
            yield { kind: "chunk", chunk: { ...event, sessionId: providerId } };
            continue;
          }
          if (event.type === "error") lastReported = event.content;
          yield { kind: "chunk", chunk: event };
        }

        // `result` is the CLI saying it has finished this exchange. In one-shot
        // mode the stream ends here; in streaming mode it is a boundary, and
        // the next message the user sends continues on the same process.
        if (message.type === "result") yield { kind: "turn-end" };
      }
    } catch (e) {
      // The stream's parting shot is the failure we have already shown: end the
      // turn rather than reporting it a second time. Ending quietly also lets
      // the caller treat this as a clean finish, which is what keeps the chat's
      // record from being discarded over a failure the user can already read.
      if (!echoesReported(e, lastReported)) throw e;
    } finally {
      exitWatch.dispose();
      input.end();
    }
  }

  return {
    send(prompt: string): void {
      // The same shape the SDK writes for a one-shot string prompt: streamInput
      // forwards each message verbatim, so this has to be what the CLI expects
      // rather than merely what the TypeScript accepts. The empty session_id is
      // the SDK's own — the CLI answers from the session it is running.
      input.push({
        type: "user",
        session_id: "",
        message: { role: "user", content: [{ type: "text", text: prompt }] },
        parent_tool_use_id: null,
      });
    },
    async interrupt(): Promise<void> {
      // Set before awaiting, so anything already on its way down is silenced too.
      stopping = true;
      try {
        await stream.interrupt?.();
      } catch {
        // Interrupting something that already stopped is not a failure; the
        // caller's intent — that it not be running — is satisfied either way.
      }
    },
    close(): void {
      input.end();
      void Promise.resolve(stream.return(undefined)).catch(() => {});
    },
    events,
    providerSessionId: () => providerId,
  };
}

/** The SDK's wording when it rethrows a result's errors as the stream's error. */
const RESULT_ECHO = "claude code returned an error result:";

/** Whether this thrown error is only repeating what the transcript already says. */
function echoesReported(thrown: unknown, reported: string | null): boolean {
  if (!reported) return false;
  const message = thrown instanceof Error ? thrown.message : String(thrown);
  const lower = message.toLowerCase();
  if (!lower.startsWith(RESULT_ECHO)) return false;
  // The SDK joins a result's errors with "; " and trims them, so compare on the
  // words rather than on punctuation that one side may have rearranged.
  const tail = message.slice(RESULT_ECHO.length).trim();
  return reported.includes(tail) || tail.includes(reported.trim());
}

export { CliExitedError };
