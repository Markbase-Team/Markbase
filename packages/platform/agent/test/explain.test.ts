import { describe, it, expect } from "vitest";
import { explainFailure } from "../src/core/explain";

// The wordings below are the ones that have actually reached the panel, taken
// from the transcripts. The point of the classifier is the difference between
// "wait" and "do something": a person who is signed out should not be told to
// try again, and a person hitting a bad half-hour at the API should not be sent
// to re-authenticate.

describe("the API is having a bad time", () => {
  it("recognises the server_error family", () => {
    const e = explainFailure('API Error: 500 {"type":"error","error":{"type":"server_error"}}');
    expect(e.title).toBe("Claude is having trouble right now");
    expect(e.retryable).toBe(true);
    expect(e.hint).toContain("Nothing is wrong on this machine");
  });

  it("recognises being overloaded", () => {
    expect(explainFailure("API Error: 529 overloaded_error").retryable).toBe(true);
    expect(explainFailure("API Error: 529 overloaded_error").title).toContain("trouble");
  });
});

describe("the connection never got there", () => {
  it.each([
    "API Error: Unable to connect to API (ECONNRESET)",
    "API Error: Connection dropped (ECONNRESET)",
    // Reached the panel unrecognised, so the whole sentence became the headline.
    "API Error: Connection closed mid-response. The response above may be incomplete.",
    "TypeError: fetch failed",
  ])("recognises %s", (raw) => {
    const e = explainFailure(raw);
    expect(e.title).toBe("Couldn't reach Claude");
    expect(e.retryable).toBe(true);
  });
});

describe("signed out", () => {
  it("recognises the 403 that started all this, and does NOT say try again", () => {
    const e = explainFailure("Failed to authenticate. API Error: 403 Request not allowed");
    expect(e.title).toBe("Claude isn't signed in on this machine");
    expect(e.retryable).toBe(false);
    expect(e.hint).toContain("claude");
  });

  it("beats the generic 4xx rule, which would call it merely refused", () => {
    expect(explainFailure("API Error: 401 Unauthorized").title).toContain("signed in");
  });
});

describe("the account, not the request", () => {
  it("recognises an empty balance and does not suggest retrying", () => {
    const e = explainFailure("Credit balance is too low to continue.");
    expect(e.title).toContain("out of credit");
    expect(e.retryable).toBe(false);
  });
});

describe("rate limits", () => {
  it("says it passes", () => {
    const e = explainFailure("API Error: 429 rate_limit_error");
    expect(e.title).toBe("Rate limited");
    expect(e.retryable).toBe(true);
  });
});

describe("our own failure", () => {
  it("recognises the CLI dying mid-answer", () => {
    const e = explainFailure("The Claude CLI exited (exit code 1) without ending the run.");
    expect(e.title).toBe("Claude stopped unexpectedly");
    expect(e.retryable).toBe(true);
  });
});

describe("something never seen before", () => {
  it("quotes it rather than inventing a diagnosis", () => {
    const e = explainFailure("Kettle boiled over");
    expect(e.title).toBe("Kettle boiled over");
    expect(e.hint).toBeNull();
  });

  it("takes the first line, so a stack trace does not become the headline", () => {
    expect(explainFailure("Something broke\n  at foo()\n  at bar()").title).toBe("Something broke");
  });

  it("clips a single enormous line", () => {
    const e = explainFailure("x".repeat(400));
    expect(e.title.length).toBeLessThanOrEqual(141);
    expect(e.title.endsWith("…")).toBe(true);
  });

  it("still says something when handed nothing", () => {
    expect(explainFailure("   ").title).toBe("The agent run failed");
  });
});

describe("case", () => {
  it("does not depend on it", () => {
    expect(explainFailure("FAILED TO AUTHENTICATE. API ERROR: 403").retryable).toBe(false);
  });
});
