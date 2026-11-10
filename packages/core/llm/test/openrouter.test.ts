import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { chatJson } from "../src/openrouter";

// The retry policy is the whole point of this module, and it was never covered:
// it lived inside a feature package that has no test setup at all. These tests
// pin the three outcomes a caller is allowed to distinguish —
//   a parsed answer, null ("the model had nothing usable"), and a throw
//   ("this machine is not configured") —
// so the move out of @markbase/attention is behaviour-preserving rather than
// hopefully-behaviour-preserving.

const OK = (content: string) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

let fetchMock: ReturnType<typeof vi.fn>;
const savedKey = process.env.OPENROUTER_API_KEY;
const savedModel = process.env.OPENROUTER_MODEL;

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = "test-key";
  delete process.env.OPENROUTER_MODEL;
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (savedKey === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = savedKey;
  if (savedModel === undefined) delete process.env.OPENROUTER_MODEL;
  else process.env.OPENROUTER_MODEL = savedModel;
});

describe("chatJson", () => {
  it("returns the parsed object", async () => {
    fetchMock.mockResolvedValueOnce(OK('{"answer":"42"}'));
    const out = await chatJson<{ answer: string }>([{ role: "user", content: "hi" }]);
    expect(out).toEqual({ answer: "42" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("digs the JSON out of fences and prose", async () => {
    fetchMock.mockResolvedValueOnce(
      OK('Sure! Here you go:\n```json\n{"answer":"42"}\n```\nHope that helps.')
    );
    expect(await chatJson([{ role: "user", content: "hi" }])).toEqual({ answer: "42" });
  });

  it("throws when the machine has no key — a config fault, not a model answer", async () => {
    delete process.env.OPENROUTER_API_KEY;
    await expect(chatJson([{ role: "user", content: "hi" }])).rejects.toThrow(
      /OPENROUTER_API_KEY/
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("gives up immediately on 4xx — a bad request does not improve by repeating it", async () => {
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 400 }));
    expect(await chatJson([{ role: "user", content: "hi" }])).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries a 429 and returns the answer that follows", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("slow down", { status: 429 }))
      .mockResolvedValueOnce(OK('{"answer":"42"}'));
    expect(await chatJson([{ role: "user", content: "hi" }])).toEqual({ answer: "42" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries a 5xx, and a thrown network error too", async () => {
    fetchMock
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValueOnce(new Response("boom", { status: 503 }))
      .mockResolvedValueOnce(OK('{"answer":"42"}'));
    expect(await chatJson([{ role: "user", content: "hi" }])).toEqual({ answer: "42" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("returns null when the output never parses, after exhausting its attempts", async () => {
    // mockImplementation, not mockResolvedValue: a Response body can only be
    // read once, so handing back one shared instance makes the second retry
    // fail on "body already read" rather than on the thing under test.
    fetchMock.mockImplementation(async () => OK("I'm afraid I can't do that."));
    expect(await chatJson([{ role: "user", content: "hi" }])).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("sends the configured model, and the default otherwise", async () => {
    fetchMock.mockImplementation(async () => OK("{}")); // fresh body per call
    await chatJson([{ role: "user", content: "hi" }]);
    const first = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(first.model).toBe("google/gemini-2.5-flash-lite");
    expect(first.response_format).toEqual({ type: "json_object" });

    process.env.OPENROUTER_MODEL = "anthropic/claude-haiku-4.5";
    fetchMock.mockClear();
    await chatJson([{ role: "user", content: "hi" }]);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body)).model).toBe(
      "anthropic/claude-haiku-4.5"
    );
  });
});
