import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/supabase", () => ({ supabase: {} }));

import {
  listUserAnalytics,
  recordUserAnalytics,
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
        vault_id: "v1",
        doc_id: "d1",
        outcome: "success",
        status: 200,
        duration_ms: 42,
      },
    ]);
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
        vaultId: "v1",
        docId: "d1",
        outcome: "success",
        status: 200,
        durationMs: 42,
      },
    ]);
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
