import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/supabase", () => ({ supabase: {} }));

import {
  listUserAnalytics,
  recordUserAnalytics,
  summarizeDocReads,
  toUserAnalyticsRow,
  type StoredUserAnalyticsRow,
  type UserAnalyticsReader,
  type UserAnalyticsRow,
  type UserAnalyticsWriter,
} from "../../src/analytics/user-analytics-store";
import type { UserAnalyticsEvent, UserAnalyticsQuery } from "@markbase/shared/analytics/user-analytics";

// One action in, one row out — and the same row read back as a record.

const agentRead: UserAnalyticsEvent = {
  ownerId: "u1",
  actor: { kind: "agent", keyId: "k1", provider: "claude_code", client: "claude-ai" },
  channel: "mcp",
  action: "docs_readDoc",
  vaultId: "v1",
  docId: "d1",
  outcome: "success",
  status: 200,
  durationMs: 41.6,
};

function stored(over: Partial<StoredUserAnalyticsRow> = {}): StoredUserAnalyticsRow {
  return { id: 7, created_at: "2026-11-23T02:00:00Z", ...toUserAnalyticsRow(agentRead), ...over };
}

function collecting(): { rows: UserAnalyticsRow[]; writer: UserAnalyticsWriter } {
  const rows: UserAnalyticsRow[] = [];
  return { rows, writer: { insert: async (row) => (rows.push(row), { error: null }) } };
}

describe("recordUserAnalytics", () => {
  it("writes an agent's action with the key, tool and client", async () => {
    const { rows, writer } = collecting();
    expect(await recordUserAnalytics(agentRead, writer)).toBe(true);
    expect(rows).toEqual([
      {
        owner_id: "u1",
        actor_kind: "agent",
        key_id: "k1",
        provider: "claude_code",
        client: "claude-ai",
        channel: "mcp",
        action: "docs_readDoc",
        detail: null,
        vault_id: "v1",
        doc_id: "d1",
        outcome: "success",
        status: 200,
        duration_ms: 42,
      },
    ]);
  });

  it("writes a hook's event at the time it happened, under the daemon's key or none", async () => {
    const { rows, writer } = collecting();
    await recordUserAnalytics(
      {
        ownerId: "u1",
        actor: { kind: "agent", keyId: null, provider: "claude_code", client: "claude" },
        channel: "hook",
        action: "hook.read",
        docId: "d1",
        outcome: "success",
        at: "2026-11-22T10:00:00.000Z",
      },
      writer
    );
    expect(rows[0]).toMatchObject({ key_id: null, client: "claude", channel: "hook", action: "hook.read", created_at: "2026-11-22T10:00:00.000Z" });
  });

  it("ignores a time that is not real or not yet, and lets the database say now", async () => {
    const { rows, writer } = collecting();
    await recordUserAnalytics({ ...agentRead, at: "not a date" }, writer);
    await recordUserAnalytics({ ...agentRead, at: "2999-01-01T00:00:00Z" }, writer);
    expect(rows.every((r) => r.created_at === undefined)).toBe(true);
  });

  it("writes a person's action with no key", async () => {
    const { rows, writer } = collecting();
    await recordUserAnalytics({ ownerId: "u1", actor: { kind: "person" }, channel: "app", action: "docs_createDoc", outcome: "success" }, writer);
    expect(rows[0]).toMatchObject({ actor_kind: "person", key_id: null, provider: null, client: null, vault_id: null, doc_id: null, status: null, duration_ms: null });
  });

  it("records an MCP or hook event as well as an endpoint", async () => {
    const { rows, writer } = collecting();
    expect(await recordUserAnalytics({ ...agentRead, action: "mcp.unknown_tool", outcome: "error" }, writer)).toBe(true);
    expect(await recordUserAnalytics({ ...agentRead, channel: "hook", action: "hook.read" }, writer)).toBe(true);
    expect(rows.map((r) => r.action)).toEqual(["mcp.unknown_tool", "hook.read"]);
  });

  it("keeps what was asked for, for an unknown tool or method only", async () => {
    const { rows, writer } = collecting();
    await recordUserAnalytics({ ...agentRead, action: "mcp.unknown_method", detail: "resources/list", outcome: "error" }, writer);
    await recordUserAnalytics({ ...agentRead, action: "docs_readDoc", detail: "should not be kept" }, writer);
    await recordUserAnalytics({ ...agentRead, action: "mcp.unknown_tool", detail: `  a\nb${"x".repeat(200)}  `, outcome: "error" }, writer);
    expect(rows.map((r) => r.detail)).toEqual(["resources/list", null, `ab${"x".repeat(78)}`]);
  });

  it("refuses an action that is not in the closed set", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { rows, writer } = collecting();
    for (const action of ["docs_readdoc", "made_up", "", "   ", "a".repeat(300)]) {
      expect(await recordUserAnalytics({ ...agentRead, action }, writer)).toBe(false);
    }
    expect(rows).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(5);
    warn.mockRestore();
  });

  it("drops a negative or non-finite status and duration", async () => {
    const { rows, writer } = collecting();
    await recordUserAnalytics({ ...agentRead, status: -1, durationMs: Number.POSITIVE_INFINITY }, writer);
    expect(rows[0]).toMatchObject({ status: null, duration_ms: null });
  });

  it("reports a failed write without throwing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const failing: UserAnalyticsWriter = { insert: async () => ({ error: { message: "nope" } }) };
    expect(await recordUserAnalytics(agentRead, failing)).toBe(false);
    const throwing: UserAnalyticsWriter = { insert: async () => Promise.reject(new Error("down")) };
    expect(await recordUserAnalytics(agentRead, throwing)).toBe(false);
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});

describe("listUserAnalytics", () => {
  const owner: UserAnalyticsQuery = { scope: { kind: "owner", ownerId: "u1" } };

  it("hands rows back as records", async () => {
    const reader: UserAnalyticsReader = { select: async () => ({ data: [stored()], error: null }) };
    expect(await listUserAnalytics(owner, reader)).toEqual([
      {
        id: 7,
        at: "2026-11-23T02:00:00Z",
        actor: { kind: "agent", keyId: "k1", provider: "claude_code", client: "claude-ai" },
        channel: "mcp",
        action: "docs_readDoc",
        detail: null,
        vaultId: "v1",
        docId: "d1",
        outcome: "success",
        status: 200,
        durationMs: 42,
      },
    ]);
  });

  it("reads an agent with no key of its own as an agent still", async () => {
    const reader: UserAnalyticsReader = { select: async () => ({ data: [stored({ key_id: null, client: "claude" })], error: null }) };
    expect((await listUserAnalytics(owner, reader))[0].actor).toEqual({ kind: "agent", keyId: null, provider: "claude_code", client: "claude" });
  });

  it("reads a tool it does not know as unknown, and skips a channel or outcome it does not know", async () => {
    const reader: UserAnalyticsReader = {
      select: async () => ({ data: [stored({ provider: "some-new-tool" }), stored({ id: 8, channel: "carrier-pigeon" }), stored({ id: 9, outcome: "shrug" })], error: null }),
    };
    const records = await listUserAnalytics(owner, reader);
    expect(records).toHaveLength(1);
    expect(records[0].actor).toMatchObject({ kind: "agent", provider: "unknown" });
  });

  it("passes a clamped page size to the reader", async () => {
    const limits: number[] = [];
    const reader: UserAnalyticsReader = { select: async (_q, limit) => (limits.push(limit), { data: [], error: null }) };
    await listUserAnalytics(owner, reader);
    await listUserAnalytics({ ...owner, limit: 9999 }, reader);
    expect(limits).toEqual([50, 200]);
  });

  it("answers an empty document scope without asking the database", async () => {
    const select = vi.fn();
    expect(await listUserAnalytics({ scope: { kind: "docs", docIds: [] } }, { select })).toEqual([]);
    expect(select).not.toHaveBeenCalled();
  });

  it("throws when the read fails", async () => {
    const reader: UserAnalyticsReader = { select: async () => ({ data: null, error: { message: "nope" } }) };
    await expect(listUserAnalytics(owner, reader)).rejects.toThrow("nope");
  });
});

describe("summarizeDocReads", () => {
  it("hands back each account's tool with its count and last read", async () => {
    const reads = await summarizeDocReads("d1", {
      reads: async () => ({
        data: [
          { owner_id: "u1", provider: "claude_code", client: "claude", reads: 4, last_at: "2026-11-23T02:00:00Z" },
          { owner_id: "u2", provider: "something-new", client: null, reads: 1, last_at: "2026-11-22T02:00:00Z" },
        ],
        error: null,
      }),
    });
    expect(reads).toEqual([
      { ownerId: "u1", provider: "claude_code", client: "claude", count: 4, lastAt: "2026-11-23T02:00:00Z" },
      { ownerId: "u2", provider: "unknown", client: null, count: 1, lastAt: "2026-11-22T02:00:00Z" },
    ]);
  });

  it("is empty for a document nobody read, and throws when the read fails", async () => {
    expect(await summarizeDocReads("d1", { reads: async () => ({ data: null, error: null }) })).toEqual([]);
    await expect(summarizeDocReads("d1", { reads: async () => ({ data: null, error: { message: "nope" } }) })).rejects.toThrow("nope");
  });
});
