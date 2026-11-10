import { describe, it, expect, vi, afterEach } from "vitest";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  sessionOver,
  type SessionEvent,
  type SessionInput,
  type SessionStream,
} from "../src/providers/claude/runtime/claudeSession";
import { MessageQueue } from "../src/providers/claude/runtime/messageQueue";
import { watchForEarlyExit, EXIT_GRACE_MS } from "../src/providers/claude/runtime/cliExitWatch";

// A session is a `claude` process that stays up between your messages. What that
// buys — a background command outliving the turn that started it — was measured
// against the real CLI. What is tested here is the logic wrapped around it,
// which is where the mistakes live: where a turn ends, what a stop the user
// asked for is allowed to print, and what a dead process means.

/** A stand-in for the SDK's stream, fed message by message from the test. */
function fakeStream(): SessionStream & { emit(m: SDKMessage): void; finish(): void } {
  const queue = new MessageQueue<SDKMessage>();
  const iterator = queue[Symbol.asyncIterator]();
  const stream = {
    next: () => iterator.next(),
    return: async () => ({ value: undefined, done: true }) as IteratorResult<SDKMessage, void>,
    throw: async () => ({ value: undefined, done: true }) as IteratorResult<SDKMessage, void>,
    [Symbol.asyncIterator]() {
      return this;
    },
    interrupt: vi.fn(async () => undefined),
    emit: (m: SDKMessage) => queue.push(m),
    finish: () => queue.end(),
  };
  return stream as unknown as SessionStream & { emit(m: SDKMessage): void; finish(): void };
}

/**
 * Text arrives as a delta, the way the CLI actually sends it with
 * includePartialMessages on — the final `assistant` message repeats the same
 * blocks and is deliberately dropped, so faking THAT would test nothing.
 */
const assistantText = (text: string): SDKMessage =>
  ({
    type: "stream_event",
    parent_tool_use_id: null,
    event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
  }) as unknown as SDKMessage;

const result = (subtype: "success" | "error_during_execution"): SDKMessage =>
  ({ type: "result", subtype, errors: subtype === "success" ? [] : ["Interrupted"] }) as unknown as SDKMessage;

const init = (sessionId: string): SDKMessage =>
  ({ type: "system", subtype: "init", session_id: sessionId, tools: [], model: "sonnet" }) as unknown as SDKMessage;

/** Collect events until `stop` says we have what the test is asking about. */
async function collect(
  events: AsyncGenerator<SessionEvent>,
  stop: (seen: SessionEvent[]) => boolean
): Promise<SessionEvent[]> {
  const seen: SessionEvent[] = [];
  for await (const e of events) {
    seen.push(e);
    if (stop(seen)) break;
  }
  return seen;
}

const turnEnds = (seen: SessionEvent[]): number => seen.filter((e) => e.kind === "turn-end").length;
const texts = (seen: SessionEvent[]): string[] =>
  seen.flatMap((e) => (e.kind === "chunk" && e.chunk.type === "text" ? [e.chunk.content] : []));
const errors = (seen: SessionEvent[]): string[] =>
  seen.flatMap((e) => (e.kind === "chunk" && e.chunk.type === "error" ? [e.chunk.content] : []));

function open(): {
  stream: ReturnType<typeof fakeStream>;
  input: MessageQueue<SessionInput>;
  session: ReturnType<typeof sessionOver>;
  watch: ReturnType<typeof watchForEarlyExit>;
} {
  const stream = fakeStream();
  const input = new MessageQueue<SessionInput>();
  const watch = watchForEarlyExit({ aborted: () => input.closed });
  return { stream, input, watch, session: sessionOver(stream, input, watch, undefined) };
}

afterEach(() => vi.useRealTimers());

describe("a turn ends without the session ending", () => {
  it("reports a boundary at `result` and keeps going", async () => {
    const { stream, session } = open();
    const events = session.events();

    stream.emit(assistantText("first answer"));
    stream.emit(result("success"));
    stream.emit(assistantText("second answer"));
    stream.emit(result("success"));

    const seen = await collect(events, (s) => turnEnds(s) === 2);
    expect(turnEnds(seen)).toBe(2);
    expect(texts(seen)).toEqual(["first answer", "second answer"]);
    // The point of the whole change: two exchanges, one stream, still open.
    expect(seen[seen.length - 1]).toEqual({ kind: "turn-end" });
  });
});

describe("a stop the user asked for", () => {
  it("does not print the error the interrupt itself produces", async () => {
    const { stream, session } = open();
    const events = session.events();

    stream.emit(assistantText("counting"));
    await session.interrupt();
    // What the CLI actually sends on interrupt — verified against the real one.
    stream.emit(result("error_during_execution"));

    const seen = await collect(events, (s) => turnEnds(s) === 1);
    expect(errors(seen)).toEqual([]);
    expect(turnEnds(seen)).toBe(1); // the spinner still stops
    expect(stream.interrupt).toHaveBeenCalled();
  });

  it("silences only that turn, not the next one", async () => {
    const { stream, session } = open();
    const events = session.events();

    await session.interrupt();
    stream.emit(result("error_during_execution"));
    stream.emit(assistantText("after the stop"));
    stream.emit(result("error_during_execution")); // a REAL failure this time

    const seen = await collect(events, (s) => turnEnds(s) === 2);
    expect(texts(seen)).toEqual(["after the stop"]);
    expect(errors(seen)).toEqual(["Interrupted"]);
  });

  it("survives a CLI that has already stopped", async () => {
    const { stream, session } = open();
    (stream.interrupt as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("not running"));
    await expect(session.interrupt()).resolves.toBeUndefined();
  });
});

describe("a failure that is not a stop", () => {
  it("is reported, because nobody asked for it", async () => {
    const { stream, session } = open();
    const events = session.events();
    stream.emit(result("error_during_execution"));
    const seen = await collect(events, (s) => turnEnds(s) === 1);
    expect(errors(seen)).toEqual(["Interrupted"]);
  });
});

describe("one failure, reported once", () => {
  // The SDK says it twice: the `result` carrying errors is enqueued, and then
  // its catch REPLACES the exit error with "Claude Code returned an error
  // result: <the same text>" and throws that at the reader.
  //
  // Driven with next() rather than a for-await that breaks: breaking finalises
  // the generator, so a second pass over it would return done immediately and
  // the test would pass without touching the code it is about.
  const failNext = (stream: ReturnType<typeof fakeStream>, message: string): void => {
    (stream as unknown as { next: () => Promise<never> }).next = () =>
      Promise.reject(new Error(message));
  };

  it("does not repeat the error the transcript already shows", async () => {
    const { stream, session } = open();
    const events = session.events();
    stream.emit(result("error_during_execution"));

    const errorEvent = await events.next();
    expect(errorEvent.value).toEqual({
      kind: "chunk",
      chunk: { type: "error", content: "Interrupted" },
    });
    expect((await events.next()).value).toEqual({ kind: "turn-end" });

    failNext(stream, "Claude Code returned an error result: Interrupted");
    // Ends rather than throwing: the failure is already on screen, and a clean
    // end is what keeps the chat's record from being discarded over it.
    expect(await events.next()).toEqual({ value: undefined, done: true });
  });

  it("still reports a failure that is NOT the one already shown", async () => {
    const { stream, session } = open();
    const events = session.events();
    stream.emit(result("error_during_execution"));
    await events.next();
    await events.next();

    failNext(stream, "Something else went wrong entirely");
    await expect(events.next()).rejects.toThrow("Something else");
  });

  it("reports the echo when nothing was shown to echo", async () => {
    const { stream, session } = open();
    const events = session.events();
    failNext(stream, "Claude Code returned an error result: boom");
    await expect(events.next()).rejects.toThrow("boom");
  });
});

describe("a CLI that dies mid-answer", () => {
  it("throws rather than leaving the caller reading a stopped stream", async () => {
    vi.useFakeTimers();
    const { stream, session, watch } = open();
    const events = session.events();
    stream.emit(assistantText("half an answ"));
    const first = await events.next();
    expect(first.value).toEqual({ kind: "chunk", chunk: { type: "text", content: "half an answ" } });

    watch.noteExit({ code: 1, signal: null });
    const pending = events.next().catch((e: Error) => e);
    await vi.advanceTimersByTimeAsync(EXIT_GRACE_MS);
    expect(await pending).toBeInstanceOf(Error);
  });
});

describe("the conversation's identity", () => {
  it("is taken from the session's own init", async () => {
    const { stream, session } = open();
    const events = session.events();
    expect(session.providerSessionId()).toBeNull();
    stream.emit(init("abc-123"));
    stream.emit(result("success"));
    await collect(events, (s) => turnEnds(s) === 1);
    expect(session.providerSessionId()).toBe("abc-123");
  });
});

describe("what send() writes", () => {
  it("is the shape the CLI reads, not merely one TypeScript accepts", async () => {
    const { input, session } = open();
    session.send("hello");
    const it = input[Symbol.asyncIterator]();
    expect((await it.next()).value).toEqual({
      type: "user",
      session_id: "",
      message: { role: "user", content: [{ type: "text", text: "hello" }] },
      parent_tool_use_id: null,
    });
  });

  it("queues a message sent while a turn is still running", async () => {
    const { input, session } = open();
    session.send("first");
    session.send("second");
    const it = input[Symbol.asyncIterator]();
    const one = (await it.next()).value as SessionInput;
    const two = (await it.next()).value as SessionInput;
    expect([one.message.content[0].text, two.message.content[0].text]).toEqual(["first", "second"]);
  });
});

describe("closing", () => {
  it("ends the input, which is what lets the CLI exit", () => {
    const { input, session } = open();
    expect(input.closed).toBe(false);
    session.close();
    expect(input.closed).toBe(true);
  });

  it("leaves the input closed when the stream ends on its own", async () => {
    const { stream, input, session } = open();
    const events = session.events();
    stream.finish();
    await collect(events, () => false);
    expect(input.closed).toBe(true);
  });
});
