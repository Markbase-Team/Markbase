import { describe, it, expect, vi, beforeEach } from "vitest";
import * as Y from "yjs";
import { CALLER_HEADER, serializeCaller, type Caller } from "@markbase/protocol/auth";
import { createDoc, setMarkdown } from "@markbase/protocol/docs/crdt";
import { snapshot } from "@markbase/protocol/docs/sync";
import { appendVersion } from "@markbase/protocol/docs/versions";
import { addAgentReads, docAnalytics, type DocAnalyticsReport } from "@markbase/protocol/docs/analytics";

// GET /docs/:id/analytics is the one place a document's analytics are asked
// for — the Analytics panel and an agent's `docs_analytics` tool both call it.
// The store is mocked at the seam the handler loads the CRDT through; what is
// under test is who gets through, and that the answer is the document's own
// reads and line credit, worded.

const getDocument = vi.fn();
const getLinkByToken = vi.fn();
const getMemberCapability = vi.fn();
const loadCrdtSnapshot = vi.fn();

vi.mock("../src/server/documents", () => ({ getDocument: (id: string) => getDocument(id) }));
vi.mock("../src/server/links", () => ({ getLinkByToken: (t: string) => getLinkByToken(t) }));
vi.mock("../src/server/members", () => ({
  getMemberCapability: (d: string, u: string) => getMemberCapability(d, u),
}));
vi.mock("../src/server/owner-name", () => ({
  ownerDisplayName: async (userId: string) => `name-of(${userId})`,
}));
vi.mock("../src/server/crdt-store", () => ({
  loadCrdtSnapshot: (id: string) => loadCrdtSnapshot(id),
}));
vi.mock("@markbase/server/db/agent-sessions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@markbase/server/db/agent-sessions")>()),
  claimAgentSession: async () => null,
}));

const { analyticsEndpoint } = await import("../src/handlers/history");
// Called the way a route calls it: its `handle`, with the path's parameters.
const docAnalyticsHandler = (r: Request, id: string) => analyticsEndpoint.handle(r, { id });

const DOC = { id: "doc_1", owner_id: "owner_1", content: "# seed\n" };
const OWNER: Caller = { via: "session", ownerId: "owner_1", email: "o@example.com" };
const MEMBER: Caller = { via: "session", ownerId: "user_2", email: "m@example.com" };
const VIEWER_KEY: Caller = {
  via: "api_key",
  ownerId: "owner_1",
  key: { id: "key_1", provider: "claude_code", capability: "viewer" },
};

/** A document Jessie started, her Claude added to, and two agents read. */
function written(): Y.Doc {
  const doc = new Y.Doc();
  const first = "# Plan\n\nShip on Monday.\n";
  setMarkdown(doc, first);
  appendVersion(doc, first, { author: "Jessie" });
  const second = `${first}\nRisks: none known.\n`;
  setMarkdown(doc, second);
  appendVersion(doc, second, { author: "Jessie", agents: ["claude"] });
  addAgentReads(doc, [
    { agent: "claude", owner: "Jessie", count: 3, lastAt: 300 },
    { agent: "codex", owner: null, count: 1, lastAt: 100 },
  ]);
  return doc;
}

function req(caller: Caller | null, headers: Record<string, string> = {}): Request {
  const all: Record<string, string> = { ...headers };
  if (caller) all[CALLER_HEADER] = serializeCaller(caller);
  return new Request("https://markbase.so/api/v1/docs/doc_1/analytics", { headers: all });
}

beforeEach(() => {
  getDocument.mockReset().mockResolvedValue(DOC);
  getLinkByToken.mockReset().mockResolvedValue(null);
  getMemberCapability.mockReset().mockResolvedValue(null);
  loadCrdtSnapshot.mockReset().mockResolvedValue({ state: snapshot(written()), version: 2 });
});

describe("GET /docs/:id/analytics", () => {
  it("answers the owner with the reads and the line credit, each writer in words", async () => {
    const res = await docAnalyticsHandler(req(OWNER), "doc_1");
    expect(res.status).toBe(200);
    const body = (await res.json()) as DocAnalyticsReport;
    expect(body.reads).toEqual([
      { agent: "claude", owner: "Jessie", count: 3, lastAt: 300, text: "Jessie's Claude" },
      { agent: "codex", owner: null, count: 1, lastAt: 100, text: "Codex" },
    ]);
    expect(body.credit?.lines).toBe(3);
    expect(body.credit?.shares).toEqual([
      { writer: { kind: "person", agents: [], person: "Jessie" }, text: "Jessie", lines: 2 },
      { writer: { kind: "agent", agents: ["claude"], person: "Jessie" }, text: "Jessie's Claude", lines: 1 },
    ]);
    expect(body.credit?.ranges.map((r) => [r.from, r.to, r.text, r.preview])).toEqual([
      [1, 3, "Jessie", "# Plan"],
      [4, 5, "Jessie's Claude", "Risks: none known."],
    ]);
  });

  it("is exactly what the document's own Y.Doc says — one function, both sides", async () => {
    const res = await docAnalyticsHandler(req(OWNER), "doc_1");
    expect(await res.json()).toEqual(docAnalytics(written()));
  });

  it("answers a viewer member", async () => {
    getMemberCapability.mockResolvedValue("viewer");
    const res = await docAnalyticsHandler(req(MEMBER), "doc_1");
    expect(res.status).toBe(200);
  });

  it("answers an API key capped at viewer — it is a read", async () => {
    expect((await docAnalyticsHandler(req(VIEWER_KEY), "doc_1")).status).toBe(200);
  });

  it("admits a share-link guest on the token", async () => {
    getLinkByToken.mockResolvedValue({ doc_id: "doc_1", mode: "guest", capability: "viewer" });
    const res = await docAnalyticsHandler(req(null, { "x-share-token": "tok" }), "doc_1");
    expect(res.status).toBe(200);
  });

  it("hides the document from a signed-in stranger, without opening it", async () => {
    const res = await docAnalyticsHandler(req(MEMBER), "doc_1");
    expect(res.status).toBe(404);
    expect(loadCrdtSnapshot).not.toHaveBeenCalled();
  });

  it("refuses nobody", async () => {
    expect((await docAnalyticsHandler(req(null), "doc_1")).status).toBe(401);
  });

  it("answers a document with no CRDT yet from its row: no reads, nothing recorded", async () => {
    loadCrdtSnapshot.mockResolvedValue(null);
    const res = await docAnalyticsHandler(req(OWNER), "doc_1");
    const body = (await res.json()) as DocAnalyticsReport;
    expect(body.reads).toEqual([]);
    expect(body.credit?.shares.map((s) => [s.text, s.lines])).toEqual([["Not recorded yet", 1]]);
    expect(createDoc(DOC.content).getMap("agentReads").size).toBe(0);
  });
});
