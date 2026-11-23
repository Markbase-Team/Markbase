import { describe, expect, it, vi } from "vitest";

vi.mock("../../../src/supabase", () => ({ supabase: {} }));

import { recordProductEvent, type EventWriter, type ProductEventRow } from "../../../src/analytics/funnel/events-store";

describe("recordProductEvent", () => {
  it("writes the event for the caller", async () => {
    const rows: ProductEventRow[] = [];
    const writer: EventWriter = { insert: async (row) => (rows.push(row), { error: null }) };
    const ok = await recordProductEvent("u1", { name: "connect_agent.shown", props: { surface: "web" } }, writer);
    expect(ok).toBe(true);
    expect(rows).toEqual([{ user_id: "u1", name: "connect_agent.shown", props: { surface: "web" } }]);
  });

  it("reports a failed write without throwing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const failing: EventWriter = { insert: async () => ({ error: { message: "boom" } }) };
    const throwing: EventWriter = {
      insert: async () => {
        throw new Error("down");
      },
    };
    expect(await recordProductEvent("u1", { name: "connect_agent.shown", props: {} }, failing)).toBe(false);
    expect(await recordProductEvent("u1", { name: "connect_agent.shown", props: {} }, throwing)).toBe(false);
    warn.mockRestore();
  });
});
