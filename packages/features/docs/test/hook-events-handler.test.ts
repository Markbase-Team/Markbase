import { beforeEach, describe, expect, it, vi } from "vitest";
import { CALLER_HEADER, serializeCaller, type Caller } from "@markbase/shared/auth";
import type { UserAnalyticsEvent } from "@markbase/shared/analytics/user-analytics";

// POST /vaults/hook-events takes a sync daemon's report of what agents' hooks saw.
// It names many documents at once, so the role each event needs is checked
// here, per document: what is under test is who may report what, and that the
// answer says, event by event, what was recorded.

const getDocument = vi.fn();
const getMemberCapability = vi.fn();
const recorded: UserAnalyticsEvent[] = [];

vi.mock("../src/server/documents", () => ({ getDocument: (id: string) => getDocument(id) }));
vi.mock("../src/server/links", () => ({ getLinkByToken: async () => null }));
vi.mock("../src/server/members", () => ({
  getMemberCapability: (d: string, u: string) => getMemberCapability(d, u),
}));
vi.mock("../src/server/owner-name", () => ({ ownerDisplayName: async () => "Jessie" }));
vi.mock("@markbase/server/analytics/user-analytics-store", () => ({
  recordUserAnalytics: async (event: UserAnalyticsEvent) => (recorded.push(event), true),
  summarizeDocReads: async () => [],
}));
vi.mock("@markbase/server/db/agent-sessions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@markbase/server/db/agent-sessions")>()),
  claimAgentSession: async () => null,
}));

const { reportVaultHookEventsEndpoint } = await import("../src/handlers/history");

const MINE = "11111111-1111-4111-8111-111111111111";
const SHARED_TO_VIEW = "22222222-2222-4222-8222-222222222222";
const STRANGERS = "33333333-3333-4333-8333-333333333333";
const DAEMON: Caller = { via: "api_key", ownerId: "u1", key: { id: "k1", provider: "unknown", capability: null } };
const AT = 1_795_000_000_000;

function post(caller: Caller | null, body: string): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (caller) headers[CALLER_HEADER] = serializeCaller(caller);
  return reportVaultHookEventsEndpoint.handle(new Request("https://markbase.so/api/v1/vaults/hook-events", { method: "POST", headers, body }), {});
}

beforeEach(() => {
  recorded.length = 0;
  getDocument.mockReset();
  getMemberCapability.mockReset();
  getDocument.mockImplementation(async (id: string) =>
    id === MINE ? { id, owner_id: "u1" } : id === SHARED_TO_VIEW || id === STRANGERS ? { id, owner_id: "u9" } : null
  );
  getMemberCapability.mockImplementation(async (doc: string) => (doc === SHARED_TO_VIEW ? "viewer" : null));
});

describe("POST /vaults/hook-events", () => {
  it("records what the caller may report, and says which it did not", async () => {
    const res = await post(
      DAEMON,
      JSON.stringify({
        events: [
          { kind: "read", agent: "claude", docId: MINE, at: AT },
          { kind: "write", agent: "claude", docId: MINE, at: AT + 1 },
          { kind: "read", agent: "codex", docId: SHARED_TO_VIEW, at: AT + 2 },
          // A viewer may say an agent read it, not that one wrote it.
          { kind: "write", agent: "codex", docId: SHARED_TO_VIEW, at: AT + 3 },
          { kind: "read", agent: "claude", docId: STRANGERS, at: AT + 4 },
        ],
      })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ recorded: [true, true, true, false, false] });
    expect(recorded.map((e) => [e.action, e.docId, e.ownerId, e.channel])).toEqual([
      ["hook.read", MINE, "u1", "hook"],
      ["hook.write", MINE, "u1", "hook"],
      ["hook.read", SHARED_TO_VIEW, "u1", "hook"],
    ]);
  });

  it("checks each document once, however many events name it", async () => {
    const events = Array.from({ length: 20 }, (_, i) => ({ kind: "read", agent: "claude", docId: MINE, at: AT + i }));
    await post(DAEMON, JSON.stringify({ events }));
    expect(getDocument).toHaveBeenCalledTimes(1);
    expect(recorded).toHaveLength(20);
  });

  it("refuses a report that is not one, and a caller with no credentials", async () => {
    expect((await post(DAEMON, JSON.stringify({ events: [{ kind: "delete", agent: "claude", docId: MINE, at: AT }] }))).status).toBe(400);
    expect((await post(DAEMON, "{nope")).status).toBe(400);
    expect((await post(null, JSON.stringify({ events: [{ kind: "read", agent: "claude", docId: MINE, at: AT }] }))).status).toBe(401);
    expect(recorded).toEqual([]);
  });
});
