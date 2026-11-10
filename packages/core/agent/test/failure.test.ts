import { describe, it, expect } from "vitest";
import { failureIn } from "../src/core/failure";
import type { StreamChunk } from "../src/core/types/chat";

const text = (content: string): StreamChunk => ({ type: "text", content });

// A failed run has to be findable afterwards. "Failed to authenticate. API Error:
// 403 Request not allowed" happened 13 times across six folders in under a month
// and left no trace in any log, because the CLI reports it as an ordinary
// assistant message rather than an error. This is what notices it.
//
// The other half matters just as much: a log full of false alarms is a log
// nobody reads. An agent explaining an API error is not an agent hitting one.

describe("failures reported as errors", () => {
  it("takes an error chunk at its word", () => {
    expect(failureIn({ type: "error", content: "rate_limit" })).toBe("rate_limit");
  });
});

describe("failures dressed as ordinary replies", () => {
  it("catches the authentication failure that started this", () => {
    const message = "Failed to authenticate. API Error: 403 Request not allowed";
    expect(failureIn(text(message))).toBe(message);
  });

  it("catches 4xx and 5xx the CLI reports the same way", () => {
    expect(failureIn(text("API Error: 401 Unauthorized"))).not.toBeNull();
    expect(failureIn(text("API Error: 500 Internal Server Error"))).not.toBeNull();
  });

  it("catches a spent balance", () => {
    expect(failureIn(text("Credit balance is too low to continue."))).not.toBeNull();
  });

  it("ignores leading whitespace, which the CLI sometimes emits", () => {
    expect(failureIn(text("\n  Failed to authenticate. API Error: 403"))).not.toBeNull();
  });
});

describe("what must NOT be read as a failure", () => {
  it("an agent explaining an error rather than hitting one", () => {
    expect(
      failureIn(text("The endpoint returns API Error: 404 when the id is unknown."))
    ).toBeNull();
  });

  it("a document about authentication", () => {
    expect(failureIn(text("Failed to authenticate is the message users see when…"))).toBeNull();
  });

  it("an ordinary answer", () => {
    expect(failureIn(text("Here is the summary you asked for."))).toBeNull();
  });

  it("chunks that carry no message at all", () => {
    expect(failureIn({ type: "assistant_message_start" })).toBeNull();
    expect(failureIn({ type: "done" })).toBeNull();
    expect(failureIn({ type: "thinking", content: "Failed to authenticate." })).toBeNull();
  });
});
