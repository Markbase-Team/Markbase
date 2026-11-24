import { describe, it, expect, vi, beforeEach } from "vitest";
import { CALLER_HEADER, serializeCaller, type Caller } from "@markbase/shared/auth";

// docs_readDoc answers an agent with the document as text. The editor's copy
// (doc_json) is many times the markdown's size; an agent's app cut such an
// answer short, and the card drawn from it could not be read. The browser and
// the desktop app still get doc_json: their editor paints it first.

const ROW = {
  id: "doc_1",
  title: "Hand-off",
  owner_id: "owner_1",
  tab_group_id: "doc_1",
  version: 3,
  content: "# stale row copy",
  content_head: "# stale row copy",
  base_doc: { type: "doc", content: [{ type: "paragraph" }] },
  doc_json: { type: "doc", content: [{ type: "paragraph" }] },
};

vi.mock("../src/server/documents", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/server/documents")>()),
  getDocument: async (id: string) => (id === "doc_1" ? ROW : null),
  createDocument: async () => ({ ...ROW, content: "# Hand-off\n\nThe text." }),
  listTabs: async () => [{ id: "doc_1", title: "Hand-off", position: 0 }],
}));
vi.mock("../src/server/doc-crdt", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/server/doc-crdt")>()),
  readDocCrdt: async () => ({ content: "# Hand-off\n\nThe text.", doc_json: { type: "doc", content: [{ type: "heading" }] } }),
}));
vi.mock("../src/server/members", () => ({ getMemberCapability: async () => null, setMemberPath: async () => true, removeMember: async () => true }));
vi.mock("../src/server/vaults", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/server/vaults")>()),
  userOwnsVault: async () => true,
  ensureDefaultVault: async () => ({ id: "vault_1" }),
}));
vi.mock("../src/server/links", () => ({ getLinkByToken: async () => null }));
vi.mock("../src/server/owner-name", () => ({ ownerDisplayName: async (u: string) => u }));
vi.mock("@markbase/server/db/agent-sessions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@markbase/server/db/agent-sessions")>()),
  claimAgentSession: async () => null,
}));

const { readDocEndpoint, createDocEndpoint } = await import("../src/handlers/documents");

const AGENT: Caller = { via: "api_key", ownerId: "owner_1", key: { id: "key_1", provider: "claude_desktop", capability: null } };
const PERSON: Caller = { via: "session", ownerId: "owner_1", email: "o@example.com" };

function read(caller: Caller, extra: Record<string, string> = {}): Promise<Response> {
  const req = new Request("https://markbase.so/api/v1/docs/doc_1", { headers: { [CALLER_HEADER]: serializeCaller(caller), ...extra } });
  return readDocEndpoint.handle(req, { id: "doc_1" });
}

beforeEach(() => vi.clearAllMocks());

describe("docs_readDoc for an agent", () => {
  it("answers an MCP call with the text and no editor copy", async () => {
    const headers: Record<string, string>[] = [{ "X-MCP-Request": "1" }, { "X-MCP-Client": "claude-ai" }];
    for (const header of headers) {
      const body = await (await read(AGENT, header)).json();
      expect(body.doc.content).toBe("# Hand-off\n\nThe text.");
      expect(body.doc).not.toHaveProperty("doc_json");
      expect(body.doc).not.toHaveProperty("base_doc");
      expect(body.doc).not.toHaveProperty("content_head");
      expect(body.doc.title).toBe("Hand-off");
      expect(body.capability).toBe("owner");
      expect(body.tabs).toHaveLength(1);
    }
  });

  it("still gives the browser and the desktop app the editor copy", async () => {
    for (const caller of [PERSON, AGENT]) {
      const body = await (await read(caller)).json();
      expect(body.doc.doc_json).toEqual({ type: "doc", content: [{ type: "heading" }] });
    }
  });
});

function create(caller: Caller, extra: Record<string, string> = {}): Promise<Response> {
  const req = new Request("https://markbase.so/api/v1/docs", {
    method: "POST",
    headers: { [CALLER_HEADER]: serializeCaller(caller), "content-type": "application/json", ...extra },
    body: JSON.stringify({ title: "Hand-off", content: "# Hand-off\n\nThe text." }),
  });
  return createDocEndpoint.handle(req, {});
}

describe("docs_createDoc for an agent", () => {
  it("answers an MCP call with the text and no editor copy", async () => {
    const res = await create(AGENT, { "X-MCP-Request": "1" });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.doc.id).toBe("doc_1");
    expect(body.doc.content).toBe("# Hand-off\n\nThe text.");
    expect(body.doc).not.toHaveProperty("doc_json");
    expect(body.doc).not.toHaveProperty("base_doc");
    expect(body.doc).not.toHaveProperty("content_head");
  });

  it("still gives the browser the editor copy", async () => {
    const body = await (await create(PERSON)).json();
    expect(body.doc.doc_json).toEqual(ROW.doc_json);
  });
});
