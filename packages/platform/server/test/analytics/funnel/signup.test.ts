import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FunnelEvent } from "@markbase/shared/analytics/funnel/events";

const recorded: { userId: string; event: FunnelEvent }[] = [];
vi.mock("../../../src/analytics/funnel/events-store", () => ({
  recordFunnelEventOnce: async (userId: string, event: FunnelEvent) => (recorded.push({ userId, event }), true),
}));

const { recordSignUp } = await import("../../../src/analytics/funnel/signup");

const NOW = new Date("2026-11-23T10:00:00Z");

beforeEach(() => {
  recorded.length = 0;
});

describe("recordSignUp", () => {
  it("records a new account's sign-up with how it signed in and where it came from", async () => {
    expect(await recordSignUp({ id: "u1", created_at: "2026-11-23T09:59:00Z", app_metadata: { provider: "google" } }, "mcp", NOW)).toBe(true);
    expect(recorded).toEqual([{ userId: "u1", event: { name: "account.sign_up", source: "mcp", props: { method: "google" } } }]);
  });

  it("records nothing for an account that is not new", async () => {
    expect(await recordSignUp({ id: "u1", created_at: "2026-10-01T00:00:00Z" }, "web", NOW)).toBe(false);
    expect(recorded).toEqual([]);
  });

  it("says unknown when it cannot tell how the account signed in", async () => {
    await recordSignUp({ id: "u1", created_at: "2026-11-23T09:59:00Z" }, "web", NOW);
    expect(recorded[0].event.props).toEqual({ method: "unknown" });
  });
});
