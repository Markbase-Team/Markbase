import { describe, expect, it, vi } from "vitest";

vi.mock("../../../src/supabase", () => ({ supabase: {} }));

import "@markbase/shared/analytics/funnel/onboarding";
import {
  recordFunnelEvent,
  recordFunnelEventDaily,
  recordFunnelEventOnce,
  type EventWriter,
  type FunnelEventRow,
} from "../../../src/analytics/funnel/events-store";

function collecting(had = false): { rows: FunnelEventRow[]; writer: EventWriter } {
  const rows: FunnelEventRow[] = [];
  return { rows, writer: { insert: async (row) => (rows.push(row), { error: null }), has: async () => had } };
}

describe("recordFunnelEvent", () => {
  it("writes the action, its source and its props for the account", async () => {
    const { rows, writer } = collecting();
    expect(await recordFunnelEvent("u1", { name: "account.sign_in", source: "cli", props: {} }, writer)).toBe(true);
    expect(rows).toEqual([{ user_id: "u1", name: "account.sign_in", source: "cli", props: {} }]);
  });

  it("does not write a name nobody declared", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { rows, writer } = collecting();
    expect(await recordFunnelEvent("u1", { name: "account.teleport", source: "web", props: {} }, writer)).toBe(false);
    expect(rows).toEqual([]);
    warn.mockRestore();
  });

  it("reports a failed write without throwing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const failing: EventWriter = { insert: async () => ({ error: { message: "boom" } }) };
    const throwing: EventWriter = { insert: async () => Promise.reject(new Error("down")) };
    const event = { name: "account.sign_in", source: "web" as const, props: {} };
    expect(await recordFunnelEvent("u1", event, failing)).toBe(false);
    expect(await recordFunnelEvent("u1", event, throwing)).toBe(false);
    warn.mockRestore();
  });
});

describe("recordFunnelEventOnce", () => {
  it("writes an event an account has not had, and not one it has", async () => {
    const fresh = collecting(false);
    expect(await recordFunnelEventOnce("u1", { name: "account.sign_up", source: "web", props: {} }, fresh.writer)).toBe(true);
    expect(fresh.rows).toHaveLength(1);
    const again = collecting(true);
    expect(await recordFunnelEventOnce("u1", { name: "account.sign_up", source: "web", props: {} }, again.writer)).toBe(false);
    expect(again.rows).toEqual([]);
  });
});

describe("recordFunnelEventDaily", () => {
  const NOW = new Date("2026-11-25T15:30:00Z");

  it("asks whether today's is already there, from the same source, and writes it when not", async () => {
    const asked: { since?: string; source?: string }[] = [];
    const rows: FunnelEventRow[] = [];
    const writer: EventWriter = {
      insert: async (row) => (rows.push(row), { error: null }),
      has: async (_user, _name, within) => (asked.push(within ?? {}), false),
    };
    expect(await recordFunnelEventDaily("u1", { name: "app.open", source: "desktop", props: {} }, writer, NOW)).toBe(true);
    expect(asked).toEqual([{ since: "2026-11-25T00:00:00.000Z", source: "desktop" }]);
    expect(rows).toHaveLength(1);
  });

  it("writes nothing when today's is already there", async () => {
    const rows: FunnelEventRow[] = [];
    const writer: EventWriter = { insert: async (row) => (rows.push(row), { error: null }), has: async () => true };
    expect(await recordFunnelEventDaily("u1", { name: "app.open", source: "web", props: {} }, writer, NOW)).toBe(false);
    expect(rows).toEqual([]);
  });
});
