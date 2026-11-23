import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Caller } from "@markbase/shared/auth";
import type { DocReadSummary, UserAnalyticsEvent } from "@markbase/shared/analytics/user-analytics";

// Reads of a document come from one record, user analytics. These pin how a
// hook's event becomes a row, and how the rows become the tally the Analytics
// panel shows.

const recorded: UserAnalyticsEvent[] = [];
let writes = true;
let summaries: DocReadSummary[] = [];
let summaryFails = false;
vi.mock("@markbase/server/analytics/user-analytics-store", () => ({
  recordUserAnalytics: async (event: UserAnalyticsEvent) => {
    if (writes) recorded.push(event);
    return writes;
  },
  summarizeDocReads: async () => {
    if (summaryFails) throw new Error("down");
    return summaries;
  },
}));
vi.mock("../src/server/owner-name", () => ({
  ownerDisplayName: async (id: string) => (id === "u1" ? "Jessie" : "Sam"),
}));

const { hookProvider, recordHookEvent, recordedDocReads } = await import("../src/server/doc-reads");

const DAEMON: Caller = { via: "api_key", ownerId: "u1", key: { id: "k1", provider: "unknown", capability: null } };
const LAST = 1_795_000_000_000;

beforeEach(() => {
  recorded.length = 0;
  writes = true;
  summaries = [];
  summaryFails = false;
});

describe("hookProvider", () => {
  it("knows a hook's 'claude' is Claude Code, and leaves a name it does not know unknown", () => {
    expect(["claude", "Claude", "codex", "cursor", "claude_desktop", "aider"].map(hookProvider)).toEqual([
      "claude_code",
      "claude_code",
      "codex",
      "cursor",
      "claude_desktop",
      "unknown",
    ]);
  });
});

describe("recordHookEvent", () => {
  it("records a read under the daemon's account and key, at the time the hook logged it", async () => {
    expect(await recordHookEvent(DAEMON, { kind: "read", agent: "claude", docId: "d1", at: LAST })).toBe(true);
    expect(recorded[0]).toEqual({
      ownerId: "u1",
      actor: { kind: "agent", keyId: "k1", provider: "claude_code", client: "claude" },
      channel: "hook",
      action: "hook.read",
      docId: "d1",
      outcome: "success",
      at: new Date(LAST).toISOString(),
    });
  });

  it("records a write as a write", async () => {
    await recordHookEvent(DAEMON, { kind: "write", agent: "cursor", docId: "d1", at: LAST });
    expect(recorded[0]).toMatchObject({ action: "hook.write", actor: { provider: "cursor", client: "cursor" } });
  });

  it("says when it could not be recorded", async () => {
    writes = false;
    expect(await recordHookEvent(DAEMON, { kind: "read", agent: "claude", docId: "d1", at: LAST })).toBe(false);
  });
});

describe("recordedDocReads", () => {
  it("names a hook's reader as the hook did, an API reader by its tool, each with its owner", async () => {
    summaries = [
      { ownerId: "u1", provider: "claude_code", client: "claude", count: 3, lastAt: new Date(LAST).toISOString() },
      { ownerId: "u1", provider: "claude_code", client: null, count: 2, lastAt: new Date(LAST + 1_000).toISOString() },
      { ownerId: "u2", provider: "claude_desktop", client: null, count: 1, lastAt: new Date(LAST).toISOString() },
    ];
    expect(await recordedDocReads("d1")).toEqual([
      { agent: "claude", owner: "Jessie", count: 3, lastAt: LAST },
      { agent: "claude", owner: "Jessie", count: 2, lastAt: LAST + 1_000 },
      { agent: "claude_desktop", owner: "Sam", count: 1, lastAt: LAST },
    ]);
  });

  it("is empty, not an error, when the record cannot be read", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    summaryFails = true;
    expect(await recordedDocReads("d1")).toEqual([]);
    warn.mockRestore();
  });
});
