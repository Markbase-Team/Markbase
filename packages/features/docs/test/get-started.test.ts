import { describe, it, expect, vi, beforeEach } from "vitest";
import { CALLER_HEADER, serializeCaller, type Caller } from "@markbase/shared/auth";

// docs_getStarted is what an agent calls for a person who has just connected
// it: what the account holds and what to ask for. In an app that shows cards
// its answer is the Get started card, so the shape is pinned here.

const listVaultsForUser = vi.fn();
const listDocumentsForUser = vi.fn();

vi.mock("../src/server/vaults", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/server/vaults")>()),
  listVaultsForUser: (u: string) => listVaultsForUser(u),
}));
vi.mock("../src/server/documents", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/server/documents")>()),
  listDocumentsForUser: (u: string) => listDocumentsForUser(u),
}));
vi.mock("../src/server/owner-name", () => ({ ownerDisplayName: async (u: string) => u }));
vi.mock("@markbase/server/db/agent-sessions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@markbase/server/db/agent-sessions")>()),
  claimAgentSession: async () => null,
}));

const { getStartedEndpoint } = await import("../src/handlers/start");

const AGENT: Caller = {
  via: "api_key",
  ownerId: "user_2",
  key: { id: "key_2", provider: "claude_desktop", capability: null },
};

function get(caller?: Caller): Request {
  const headers: Record<string, string> = caller ? { [CALLER_HEADER]: serializeCaller(caller) } : {};
  return new Request("https://markbase.so/api/v1/docs/start", { headers });
}

const doc = (n: number) => ({
  id: `doc_${n}`,
  title: `Doc ${n}`,
  content_head: `# Doc ${n}\n\nSome **text** in it.`,
  vault_id: "vault_a",
  updated_at: `2026-11-2${n}T00:00:00Z`,
  owner_id: "user_2",
  version: 1,
});

beforeEach(() => {
  listVaultsForUser.mockReset().mockResolvedValue([{ id: "vault_a", name: "My Vault", owner_id: "user_2", created_at: "x", updated_at: "x" }]);
  listDocumentsForUser.mockReset().mockResolvedValue([]);
});

describe("GET /docs/start", () => {
  it("answers a connector-first account: its vault, its Welcome document, and things to try", async () => {
    listDocumentsForUser.mockResolvedValue([
      { ...doc(1), title: "Welcome to Markbase 👋", content_head: "This is your first document." },
    ]);
    const res = await getStartedEndpoint.handle(get(AGENT), {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(listVaultsForUser).toHaveBeenCalledWith("user_2");
    expect(body.vaults).toEqual([{ id: "vault_a", name: "My Vault" }]);
    expect(body.documents).toEqual([
      {
        id: "doc_1",
        title: "Welcome to Markbase 👋",
        excerpt: "This is your first document.",
        vault_id: "vault_a",
        updated_at: "2026-11-21T00:00:00Z",
      },
    ]);
    expect(body.suggestions.map((s: { title: string }) => s.title)).toEqual([
      "Summarize this conversation as a document",
      "Review a document and comment on it",
      "Share a document with someone",
    ]);
    expect(body.suggestions[1].prompt).toContain("Welcome to Markbase 👋");
    expect(body.suggestions[2].prompt).toContain("Welcome to Markbase 👋");
    for (const s of body.suggestions) expect(Object.keys(s).sort()).toEqual(["description", "prompt", "title"]);
  });

  it("still has something to try on an account with no documents", async () => {
    const body = await (await getStartedEndpoint.handle(get(AGENT), {})).json();
    expect(body.documents).toEqual([]);
    expect(body.suggestions).toHaveLength(3);
    expect(body.suggestions[1].prompt).toContain("ask me which");
  });

  it("carries the five newest documents, and names the newest in its suggestions", async () => {
    listDocumentsForUser.mockResolvedValue([7, 6, 5, 4, 3, 2, 1].map(doc));
    const body = await (await getStartedEndpoint.handle(get(AGENT), {})).json();
    expect(body.documents.map((d: { id: string }) => d.id)).toEqual(["doc_7", "doc_6", "doc_5", "doc_4", "doc_3"]);
    expect(body.suggestions[1].prompt).toContain('"Doc 7"');
  });

  it("is refused without a signed-in caller", async () => {
    expect((await getStartedEndpoint.handle(get(), {})).status).toBe(401);
    expect(listVaultsForUser).not.toHaveBeenCalled();
  });
});
