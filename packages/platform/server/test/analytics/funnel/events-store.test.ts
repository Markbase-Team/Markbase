import { describe, expect, it, vi } from "vitest";

vi.mock("../../../src/supabase", () => ({ supabase: {} }));

import "@markbase/shared/analytics/funnel/onboarding";
import { recordFunnelEvent, recordFunnelEventOnce, type EventWriter, type FunnelEventRow } from "../../../src/analytics/funnel/events-store";

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
