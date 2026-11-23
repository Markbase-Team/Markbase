import { describe, it, expect } from "vitest";
import { MAX_POLL_BACKOFF_MS, nextPollDelay } from "../src/poll-backoff";

// The wait a polling loop takes between tries. The property that matters is the
// one that was missing on 2026-09-13: a loop whose server is failing asks it less
// often, not at the same rate forever.

const highest = (): number => 1 - Number.EPSILON;
const lowest = (): number => 0;

describe("nextPollDelay", () => {
  it("polls at the base rate while nothing is failing", () => {
    expect(nextPollDelay(15_000, 0)).toBe(15_000);
  });

  it("doubles with each consecutive failure", () => {
    expect(nextPollDelay(15_000, 1, undefined, highest)).toBe(30_000);
    expect(nextPollDelay(15_000, 2, undefined, highest)).toBe(60_000);
    expect(nextPollDelay(15_000, 3, undefined, highest)).toBe(120_000);
  });

  it("jitters, but never below half the backed-off wait", () => {
    expect(nextPollDelay(15_000, 3, undefined, lowest)).toBe(60_000);
  });

  it("stops growing at the cap", () => {
    expect(nextPollDelay(15_000, 50, undefined, highest)).toBe(MAX_POLL_BACKOFF_MS);
    expect(nextPollDelay(3_000, 1_000, undefined, lowest)).toBe(MAX_POLL_BACKOFF_MS / 2);
  });

  it("never waits less than the base interval", () => {
    expect(nextPollDelay(15_000, 1, undefined, lowest)).toBe(15_000);
    expect(nextPollDelay(15_000, 4, 1_000, lowest)).toBe(15_000);
  });
});
