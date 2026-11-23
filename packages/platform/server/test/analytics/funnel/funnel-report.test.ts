import { describe, expect, it, vi } from "vitest";

vi.mock("../../../src/supabase", () => ({ supabase: {} }));

import type { Funnel, FunnelSignal } from "@markbase/shared/analytics/funnel/funnels";
import { formatFunnelReport, runFunnel, type Occurrence, type SignalReader } from "../../../src/analytics/funnel/funnel-report";

// The engine, against a reader that answers from a list: who entered, how far
// each got, in order and in time.

const H = 3_600_000;
const T0 = Date.parse("2026-11-16T09:00:00Z"); // a Monday

/** Occurrences keyed by the signal they answer: an event name, or "action:<name>". */
function reader(data: Record<string, Occurrence[]>): SignalReader {
  return {
    occurrences: async (signal: FunnelSignal, from: Date, to: Date) => {
      const key = "event" in signal ? signal.event : `action:${signal.action}`;
      return (data[key] ?? []).filter((o) => o.at >= from.getTime() && o.at < to.getTime());
    },
  };
}
const at = (subject: string, hours: number, source: string | null = "web"): Occurrence => ({ subject, at: T0 + hours * H, source });

const funnel: Funnel = {
  id: "test_funnel",
  title: "Test",
  subject: "account",
  windowDays: 2,
  steps: [
    { id: "a", label: "Signed up", signals: [{ event: "account.sign_up" }] },
    { id: "b", label: "Vault", signals: [{ action: "docs_createVault" }, { event: "vault.provision" }] },
    { id: "c", label: "Back later", signals: [{ action: "*" }], atLeastHoursAfterStart: 24 },
  ],
};
const period = { since: new Date(T0 - H), until: new Date(T0 + 30 * 24 * H) };

describe("runFunnel", () => {
  it("follows each subject through the steps in order, and counts conversion", async () => {
    const report = await runFunnel(
      funnel,
      period,
      reader({
        "account.sign_up": [at("u1", 0), at("u2", 1, "mcp"), at("u3", 2)],
        "action:docs_createVault": [at("u1", 1)],
        "vault.provision": [at("u2", 1)],
        "action:*": [at("u1", 2), at("u1", 30), at("u2", 5)],
      })
    );
    expect(report.steps.map((s) => [s.id, s.reached])).toEqual([
      ["a", 3],
      ["b", 2],
      ["c", 1],
    ]);
    expect(report.steps[1].ofPrevious).toBeCloseTo(2 / 3);
    expect(report.steps[2].ofStart).toBeCloseTo(1 / 3);
    // u1 came back after a day; its activity two hours in does not count.
    const u1 = report.subjects.find((s) => s.subject === "u1");
    expect(u1?.reachedAt[2]).toBe(new Date(T0 + 30 * H).toISOString());
  });

  it("only counts a step at or after the one before it, and within the window", async () => {
    const report = await runFunnel(
      funnel,
      period,
      reader({
        "account.sign_up": [at("u1", 10), at("u2", 0)],
        // u1 made its vault before signing up; u2 made it after the window.
        "action:docs_createVault": [at("u1", 5), at("u2", 49)],
      })
    );
    expect(report.steps.map((s) => s.reached)).toEqual([2, 0, 0]);
  });

  it("enters a subject at its first sign-up only, and only inside the period", async () => {
    const report = await runFunnel(
      funnel,
      { since: new Date(T0), until: new Date(T0 + 24 * H) },
      reader({ "account.sign_up": [at("u1", -5), at("u2", 3), at("u2", 6), at("u3", 30)] })
    );
    expect(report.subjects.map((s) => [s.subject, s.reachedAt[0]])).toEqual([["u2", new Date(T0 + 3 * H).toISOString()]]);
  });

  it("splits the counts by the source a subject entered from, and by week", async () => {
    const report = await runFunnel(
      funnel,
      period,
      reader({
        "account.sign_up": [at("u1", 0, "web"), at("u2", 0, "mcp"), at("u3", 24 * 7, "mcp")],
        "vault.provision": [at("u2", 1, "mcp")],
      })
    );
    expect(report.bySource).toEqual({ web: [1, 0, 0], mcp: [2, 1, 0] });
    expect(report.byWeek).toEqual({ "2026-11-16": [2, 1, 0], "2026-11-23": [1, 0, 0] });
    expect(formatFunnelReport(funnel, report)).toContain("by source");
  });

  it("reports nobody when nobody entered", async () => {
    const report = await runFunnel(funnel, period, reader({}));
    expect(report.steps.map((s) => [s.reached, s.ofPrevious, s.ofStart])).toEqual([
      [0, 1, 0],
      [0, 0, 0],
      [0, 0, 0],
    ]);
  });
});
