import { describe, it, expect, vi, beforeEach } from "vitest";
import { CALLER_HEADER, serializeCaller, type Caller } from "@markbase/protocol/auth";
import { bytesToBase64 } from "../src/logic/crdt-supabase";
import { createDoc } from "../src/logic/crdt";
import { snapshot } from "../src/logic/sync";

// The CRDT endpoints enforce exactly what the rest of the document API does:
// viewer to read, editor to write, a key's ceiling applied, a share-link guest
// admitted on its token. The store and the broadcast are mocked at the seam the
// handler calls them through; what is under test is who gets through, and what
// the handler does with the answer.

const getDocument = vi.fn();
const getLinkByToken = vi.fn();
const getMemberCapability = vi.fn();
const loadCrdtSnapshot = vi.fn();
const saveCrdtSnapshot = vi.fn();
const broadcastCrdt = vi.fn();
const listCrdtChanges = vi.fn();

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
  saveCrdtSnapshot: (id: string, bytes: Uint8Array) => saveCrdtSnapshot(id, bytes),
  broadcastCrdt: (id: string, u: Uint8Array) => broadcastCrdt(id, u),
  listCrdtChanges: (u: string, s: string | null, v?: string) => listCrdtChanges(u, s, v),
}));
vi.mock("@markbase/protocol", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@markbase/protocol")>()),
  claimAgentSession: async () => null,
}));

const { docCrdtHandler, docCrdtChangesHandler } = await import("../src/handlers/crdt");

const DOC = { id: "doc_1", owner_id: "owner_1", content: "# seed\n" };
const OWNER: Caller = { via: "session", ownerId: "owner_1", email: "o@example.com" };
const MEMBER: Caller = { via: "session", ownerId: "user_2", email: "m@example.com" };
const CAPPED_KEY: Caller = {
  via: "api_key",
  ownerId: "owner_1",
  key: { id: "key_1", provider: "claude_code", capability: "viewer" },
};
const DAEMON_KEY: Caller = {
  via: "api_key",
  ownerId: "owner_1",
  key: { id: "key_2", provider: "claude_code", capability: null },
};

const STATE = snapshot(createDoc("# stored\n"));

function req(
  caller: Caller | null,
  init: { method?: string; body?: string; headers?: Record<string, string>; query?: string } = {}
): Request {
  const headers: Record<string, string> = { ...(init.headers ?? {}) };
  if (caller) headers[CALLER_HEADER] = serializeCaller(caller);
  if (init.body) headers["content-type"] = "application/json";
  return new Request(`https://markbase.so/api/v1/docs/doc_1/crdt${init.query ?? ""}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body,
  });
}

beforeEach(() => {
  getDocument.mockReset().mockResolvedValue(DOC);
  getLinkByToken.mockReset().mockResolvedValue(null);
  getMemberCapability.mockReset().mockResolvedValue(null);
  loadCrdtSnapshot.mockReset().mockResolvedValue({ state: STATE, version: 4 });
  saveCrdtSnapshot.mockReset().mockImplementation(async (_id: string, bytes: Uint8Array) => ({
    version: 5,
    changed: true,
    delta: bytes,
    state: bytes,
  }));
  broadcastCrdt.mockReset().mockResolvedValue(undefined);
  listCrdtChanges.mockReset().mockResolvedValue({ cursor: "c1", changes: [] });
});

describe("GET /docs/:id/crdt", () => {
  it("answers the owner with the snapshot and its version", async () => {
    const res = await docCrdtHandler.GET(req(OWNER), "doc_1");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ state: bytesToBase64(STATE), version: 4 });
  });

  it("answers a viewer member — reading needs viewer, as GET /docs/:id does", async () => {
    getMemberCapability.mockResolvedValue("viewer");
    const res = await docCrdtHandler.GET(req(MEMBER), "doc_1");
    expect(res.status).toBe(200);
  });

  it("hides the document from a signed-in stranger", async () => {
    const res = await docCrdtHandler.GET(req(MEMBER), "doc_1");
    expect(res.status).toBe(404);
    expect(loadCrdtSnapshot).not.toHaveBeenCalled();
  });

  it("refuses nobody", async () => {
    expect((await docCrdtHandler.GET(req(null), "doc_1")).status).toBe(401);
  });

  it("admits a share-link guest on the token", async () => {
    getLinkByToken.mockResolvedValue({ doc_id: "doc_1", mode: "guest", capability: "viewer" });
    const res = await docCrdtHandler.GET(req(null, { headers: { "x-share-token": "tok" } }), "doc_1");
    expect(res.status).toBe(200);
  });

  it("says `unchanged` without the state when the caller already holds this version", async () => {
    const res = await docCrdtHandler.GET(req(OWNER, { query: "?after=4" }), "doc_1");
    expect(await res.json()).toEqual({ version: 4, unchanged: true });
    const older = await docCrdtHandler.GET(req(OWNER, { query: "?after=3" }), "doc_1");
    expect(await older.json()).toMatchObject({ version: 4, state: expect.any(String) });
  });

  it("reports an empty cloud as version 0 with no state", async () => {
    loadCrdtSnapshot.mockResolvedValue(null);
    const res = await docCrdtHandler.GET(req(OWNER), "doc_1");
    expect(await res.json()).toEqual({ state: null, version: 0 });
  });
});

describe("POST /docs/:id/crdt", () => {
  const incoming = snapshot(createDoc("# incoming\n"));
  const body = JSON.stringify({ state: bytesToBase64(incoming) });

  it("merges an editor's snapshot and broadcasts what it added", async () => {
    getMemberCapability.mockResolvedValue("editor");
    const res = await docCrdtHandler.POST(req(MEMBER, { method: "POST", body }), "doc_1");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ version: 5 });
    expect(saveCrdtSnapshot).toHaveBeenCalledWith("doc_1", incoming);
    expect(broadcastCrdt).toHaveBeenCalledWith("doc_1", incoming);
  });

  it("refuses a viewer's write — the write the lockdown exists for", async () => {
    getMemberCapability.mockResolvedValue("viewer");
    const res = await docCrdtHandler.POST(req(MEMBER, { method: "POST", body }), "doc_1");
    expect(res.status).toBe(403);
    expect(saveCrdtSnapshot).not.toHaveBeenCalled();
    expect(broadcastCrdt).not.toHaveBeenCalled();
  });

  it("refuses a commenter's write too", async () => {
    getMemberCapability.mockResolvedValue("commenter");
    expect((await docCrdtHandler.POST(req(MEMBER, { method: "POST", body }), "doc_1")).status).toBe(403);
  });

  it("applies an API key's ceiling: the owner's own key, capped at viewer, may not write", async () => {
    const res = await docCrdtHandler.POST(req(CAPPED_KEY, { method: "POST", body }), "doc_1");
    expect(res.status).toBe(403);
  });

  it("lets the daemon's uncapped key write the owner's document", async () => {
    const res = await docCrdtHandler.POST(req(DAEMON_KEY, { method: "POST", body }), "doc_1");
    expect(res.status).toBe(200);
  });

  it("does not broadcast a save that changed nothing", async () => {
    saveCrdtSnapshot.mockResolvedValue({ version: 4, changed: false, delta: null, state: STATE });
    const res = await docCrdtHandler.POST(req(OWNER, { method: "POST", body }), "doc_1");
    expect(await res.json()).toEqual({ version: 4 });
    expect(broadcastCrdt).not.toHaveBeenCalled();
  });

  it("rejects a body with no state, and state that is not a Yjs update", async () => {
    expect(
      (await docCrdtHandler.POST(req(OWNER, { method: "POST", body: "{}" }), "doc_1")).status
    ).toBe(400);
    saveCrdtSnapshot.mockRejectedValue(new Error("Unexpected end of array"));
    const junk = JSON.stringify({ state: bytesToBase64(new Uint8Array([1, 2, 3])) });
    const res = await docCrdtHandler.POST(req(OWNER, { method: "POST", body: junk }), "doc_1");
    expect(res.status).toBe(400);
    expect(broadcastCrdt).not.toHaveBeenCalled();
  });

  it("answers 503 when the cloud is the problem, so the daemon retries", async () => {
    saveCrdtSnapshot.mockRejectedValue(new Error("saving the snapshot for doc_1: fetch failed"));
    const res = await docCrdtHandler.POST(req(OWNER, { method: "POST", body }), "doc_1");
    expect(res.status).toBe(503);
  });
});

describe("GET /docs/crdt/changes", () => {
  const changes = (caller: Caller | null, query = "") =>
    docCrdtChangesHandler.GET(
      new Request(`https://markbase.so/api/v1/docs/crdt/changes${query}`, {
        headers: caller ? { [CALLER_HEADER]: serializeCaller(caller) } : {},
      })
    );

  it("lists for the caller's own account, scoped to the vault it names", async () => {
    listCrdtChanges.mockResolvedValue({ cursor: "c2", changes: [{ doc_id: "doc_1", version: 5 }] });
    const res = await changes(DAEMON_KEY, "?since=c1&vault=v1");
    expect(await res.json()).toEqual({ cursor: "c2", changes: [{ doc_id: "doc_1", version: 5 }] });
    expect(listCrdtChanges).toHaveBeenCalledWith("owner_1", "c1", { vaultId: "v1" });
  });

  it("lists the documents shared with the caller for `scope=shared` — their Shared Vault", async () => {
    await changes(MEMBER, "?since=c1&scope=shared");
    expect(listCrdtChanges).toHaveBeenCalledWith("user_2", "c1", "shared");
  });

  it("covers everything the caller can see when neither vault nor scope is given", async () => {
    await changes(OWNER, "?since=c1");
    expect(listCrdtChanges).toHaveBeenCalledWith("owner_1", "c1", { vaultId: undefined });
  });

  it("refuses a scope it does not know, and a vault together with scope=shared", async () => {
    expect((await changes(OWNER, "?since=c1&scope=mine")).status).toBe(400);
    expect((await changes(OWNER, "?since=c1&scope=shared&vault=v1")).status).toBe(400);
    expect(listCrdtChanges).not.toHaveBeenCalled();
  });

  it("is nobody's without an account — a guest polls its document instead", async () => {
    expect((await changes(null)).status).toBe(401);
    expect(listCrdtChanges).not.toHaveBeenCalled();
  });

  it("turns a bad cursor into a 400", async () => {
    listCrdtChanges.mockRejectedValue(new Error("since must be an ISO timestamp"));
    expect((await changes(OWNER, "?since=yesterday")).status).toBe(400);
  });
});
