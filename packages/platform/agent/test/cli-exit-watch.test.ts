import { describe, it, expect, vi, afterEach } from "vitest";
import { watchForEarlyExit, describeExit, EXIT_GRACE_MS } from "../src/providers/claude/runtime/cliExitWatch";

// A run whose CLI has died must not leave the caller reading a stream that has
// already stopped. The SDK's reader can park in two places — `for await` over a
// stdout that never reaches EOF, and a `waitForExit()` that registers
// `once("exit")` on a process that has already exited — and neither unparks on
// its own. This watches the process instead.

/** Whether `died` has rejected yet, without hanging if it has not. Racing
 *  against a resolved promise would not do: the marker wins the first microtask
 *  and an already-rejected promise still reads as pending. Drain the queue. */
const settled = async (p: Promise<never>): Promise<"pending" | Error> => {
  let outcome: "pending" | Error = "pending";
  void p.catch((e: Error) => {
    outcome = e;
  });
  for (let i = 0; i < 4; i++) await Promise.resolve();
  return outcome;
};

afterEach(() => vi.useRealTimers());

describe("a CLI that dies mid-run", () => {
  it("is reported once the grace period passes", async () => {
    vi.useFakeTimers();
    const watch = watchForEarlyExit({ aborted: () => false });
    watch.noteExit({ code: 1, signal: null });

    expect(await settled(watch.died)).toBe("pending"); // still draining
    await vi.advanceTimersByTimeAsync(EXIT_GRACE_MS);

    const error = await settled(watch.died);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("exit code 1");
  });

  it("is reported when a signal killed it, which is when the SDK is likeliest to miss it", async () => {
    vi.useFakeTimers();
    const watch = watchForEarlyExit({ aborted: () => false });
    watch.noteExit({ code: null, signal: "SIGKILL" });
    await vi.advanceTimersByTimeAsync(EXIT_GRACE_MS);
    expect(((await settled(watch.died)) as Error).message).toContain("SIGKILL");
  });

  it("is reported even on a clean exit code — the run still never ended", async () => {
    vi.useFakeTimers();
    const watch = watchForEarlyExit({ aborted: () => false });
    watch.noteExit({ code: 0, signal: null });
    await vi.advanceTimersByTimeAsync(EXIT_GRACE_MS);
    expect(await settled(watch.died)).toBeInstanceOf(Error);
  });
});

describe("what must NOT be reported as a death", () => {
  it("a run that ended normally, even though the CLI exits then too", async () => {
    vi.useFakeTimers();
    const watch = watchForEarlyExit({ aborted: () => false });
    watch.noteExit({ code: 0, signal: null });
    watch.dispose(); // the stream ended, as it does on every normal turn
    await vi.advanceTimersByTimeAsync(EXIT_GRACE_MS * 4);
    expect(await settled(watch.died)).toBe("pending");
  });

  it("a stop the user asked for — aborting kills the CLI, so abort exits too", async () => {
    vi.useFakeTimers();
    const watch = watchForEarlyExit({ aborted: () => true });
    watch.noteExit({ code: null, signal: "SIGTERM" });
    await vi.advanceTimersByTimeAsync(EXIT_GRACE_MS * 4);
    expect(await settled(watch.died)).toBe("pending");
  });

  it("a live run — nothing has exited", async () => {
    vi.useFakeTimers();
    const watch = watchForEarlyExit({ aborted: () => false });
    await vi.advanceTimersByTimeAsync(EXIT_GRACE_MS * 10);
    expect(await settled(watch.died)).toBe("pending");
  });
});

describe("the wording that reaches the log", () => {
  it("names the exit code, the signal, or says it does not know", () => {
    expect(describeExit({ code: 2, signal: null })).toBe("exit code 2");
    expect(describeExit({ code: null, signal: "SIGTERM" })).toBe("killed by SIGTERM");
    expect(describeExit({ code: null, signal: null })).toBe("exit status unknown");
  });

  it("prefers the signal, which says more than the code it implies", () => {
    expect(describeExit({ code: null, signal: "SIGKILL" })).toContain("SIGKILL");
  });
});
