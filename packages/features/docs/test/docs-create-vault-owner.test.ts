import { describe, it, expect, vi, beforeEach } from "vitest";
import { CALLER_HEADER, serializeCaller, type Caller } from "@markbase/protocol/auth";

// POST /docs puts a document into a vault, and the vault has to be the
// caller's. The row's owner_id comes from the caller; its vault_id comes from
// the body; nothing else ties the two together. On 2026-10-30 a desktop app
// signed into a second account kept the first account's folders mounted,
// listed them under the new key (zero documents — not that account's), and
// POSTed every file back with `adopt: true` and the FIRST account's vault_id.
// The server took the vault_id on trust and created 116 documents owned by
// the second account inside the first account's vaults. These tests pin the
// refusal, on both the plain and the adopt path, and that the owner's own
// requests are untouched.

const createDocument = vi.fn();
const reviveForFile = vi.fn();
const getVault = vi.fn();
const ensureDefaultVault = vi.fn();

vi.mock("../src/server/documents", () => ({
  createDocument: (input: Record<string, string | null | undefined | { kind: string }>) => createDocument(input),
  getDocument: async () => null,
  listDocumentsForUser: async () => [],
  listSharedDocumentsForUser: async () => [],
}));
vi.mock("../src/server/vaults", () => ({
  getVault: (id: string) => getVault(id),
  ensureDefaultVault: (u: string) => ensureDefaultVault(u),
  userOwnsVault: async (id: string, userId: string) => {
    const v = (await getVault(id)) as { owner_id: string } | null;
    return v !== null && v.owner_id === userId;
  },
}));
vi.mock("../src/server/revive-doc", () => ({
  reviveForFile: (input: { vaultId: string; path: string; content: string }) => reviveForFile(input),
}));
vi.mock("../src/server/members", () => ({
  getMemberCapability: async () => null,
  setMemberPath: async () => true,
  removeMember: async () => true,
}));
vi.mock("../src/server/links", () => ({ getLinkByToken: async () => null }));
vi.mock("../src/server/owner-name", () => ({
  ownerDisplayName: async (userId: string) => `name-of(${userId})`,
}));
vi.mock("@markbase/server/db/agent-sessions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@markbase/server/db/agent-sessions")>()),
  claimAgentSession: async () => null,
}));

const { createDocEndpoint } = await import("../src/handlers/documents");
// The tests below call an endpoint the way a route does: its `handle`, with the
// path's parameters. These keep the call sites reading as method-on-resource.
const docsHandler = { POST: (r: Request) => createDocEndpoint.handle(r, {}) };

const OWNER: Caller = { via: "session", ownerId: "owner_1", email: "o@example.com" };
/** The second account's daemon: the shape the incident had. */
const OTHER_KEY: Caller = {
  via: "api_key",
  ownerId: "user_2",
  key: { id: "key_2", provider: "claude_code", capability: null },
};

function post(caller: Caller, body: Record<string, string | boolean | undefined>): Request {
  return new Request("https://markbase.so/api/v1/docs", {
    method: "POST",
    headers: { [CALLER_HEADER]: serializeCaller(caller), "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  createDocument.mockReset().mockImplementation(async (input) => ({ id: "doc_new", ...input }));
  reviveForFile.mockReset().mockResolvedValue(null);
  getVault.mockReset().mockImplementation(async (id: string) =>
    id === "vault_a" ? { id: "vault_a", name: "Work", owner_id: "owner_1" } : null
  );
  ensureDefaultVault.mockReset().mockResolvedValue({ id: "vault_default", owner_id: "user_2" });
});

describe("POST /docs with someone else's vault_id", () => {
  it("is refused with 403, and nothing is created", async () => {
    const res = await docsHandler.POST(
      post(OTHER_KEY, { title: "Notes", content: "# Notes\n", vault_id: "vault_a" })
    );
    expect(res.status).toBe(403);
    expect(createDocument).not.toHaveBeenCalled();
    expect(reviveForFile).not.toHaveBeenCalled();
  });

  it("is refused on the adopt path too — the one the daemon takes — before the trash is read", async () => {
    const res = await docsHandler.POST(
      post(OTHER_KEY, { title: "Notes", content: "# Notes\n", path: "notes.md", vault_id: "vault_a", adopt: true })
    );
    expect(res.status).toBe(403);
    expect(reviveForFile).not.toHaveBeenCalled();
    expect(createDocument).not.toHaveBeenCalled();
  });

  it("answers the same for a vault that does not exist — a probe learns nothing", async () => {
    const res = await docsHandler.POST(post(OTHER_KEY, { title: "x", vault_id: "vault_nope" }));
    expect(res.status).toBe(403);
    expect(createDocument).not.toHaveBeenCalled();
  });
});

describe("POST /docs by the vault's owner", () => {
  it("creates the document in that vault", async () => {
    const res = await docsHandler.POST(
      post(OWNER, { title: "Notes", content: "# Notes\n", vault_id: "vault_a" })
    );
    expect(res.status).toBe(201);
    expect(createDocument).toHaveBeenCalledTimes(1);
    expect(createDocument.mock.calls[0][0]).toMatchObject({ owner_id: "owner_1", vault_id: "vault_a" });
  });

  it("names the creator, so the first version is theirs", async () => {
    // A document Codex created read "Not recorded yet", then as the person's:
    // the row was inserted and nothing cut a version until the next viewer's
    // idle ticker did. createDocument now cuts it, credited to the key's
    // owner and tool — which the handler has to hand it.
    const res = await docsHandler.POST(post(OTHER_KEY, { title: "Notes", content: "# Notes\n" }));
    expect(res.status).toBe(201);
    const { by } = createDocument.mock.calls[0][0] as { by: { kind: string; agent?: { owner: string; tool: string | null } } };
    expect(by.kind).toBe("agent");
    expect(by.agent).toEqual({ owner: "name-of(user_2)", tool: "claude" });
  });

  it("still tries to revive a returning file on the adopt path", async () => {
    reviveForFile.mockResolvedValue({ doc: { id: "doc_old" }, by: "content" });
    const res = await docsHandler.POST(
      post(OWNER, { content: "# Notes\n", path: "notes.md", vault_id: "vault_a", adopt: true })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ doc: { id: "doc_old" }, revived: "content" });
    expect(reviveForFile).toHaveBeenCalledWith({ vaultId: "vault_a", path: "notes.md", content: "# Notes\n" });
    expect(createDocument).not.toHaveBeenCalled();
  });

  it("resolves the default vault when none is named, without any ownership question", async () => {
    const res = await docsHandler.POST(post(OTHER_KEY, { title: "Notes" }));
    expect(res.status).toBe(201);
    expect(getVault).not.toHaveBeenCalled();
    expect(ensureDefaultVault).toHaveBeenCalledWith("user_2");
    expect(createDocument.mock.calls[0][0]).toMatchObject({ owner_id: "user_2", vault_id: "vault_default" });
  });
});

// A file the sync daemon adopts was written by someone, and the daemon knows
// who from the agents' hooks. Its key is the owner's, so the caller reads as
// "an agent" — and before `written_by`, every file that appeared in a vault,
// typed in Obsidian or written by Claude, was created by "Jessie's agent".

/** The desktop app's daemon: the owner's key, stamped with no tool. */
const APP_KEY: Caller = {
  via: "api_key",
  ownerId: "owner_1",
  key: { id: "key_app", provider: "unknown", capability: null },
};

type AdoptBody = {
  content: string;
  path: string;
  vault_id: string;
  adopt?: boolean;
  written_by?: { agent: string | null } | { agent: number } | null;
};

function adoptPost(caller: Caller, body: AdoptBody): Request {
  return new Request("https://markbase.so/api/v1/docs", {
    method: "POST",
    headers: { [CALLER_HEADER]: serializeCaller(caller), "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

type CreatedBy = { kind: string; name: string; userId: string; agent?: { owner: string; tool: string | null } };
const createdBy = (): CreatedBy => (createDocument.mock.calls[0][0] as { by: CreatedBy }).by;
const FILE = { content: "# Notes\n", path: "notes.md", vault_id: "vault_a" };

describe("POST /docs adopting a file, with who wrote it", () => {
  it("credits the agent its hook named, on the owner's behalf", async () => {
    const res = await docsHandler.POST(adoptPost(APP_KEY, { ...FILE, adopt: true, written_by: { agent: "claude" } }));
    expect(res.status).toBe(201);
    expect(createdBy()).toMatchObject({ kind: "agent", userId: "owner_1", agent: { owner: "name-of(owner_1)", tool: "claude" } });
  });

  it("credits the person when no hook recorded the write", async () => {
    const res = await docsHandler.POST(adoptPost(APP_KEY, { ...FILE, adopt: true, written_by: { agent: null } }));
    expect(res.status).toBe(201);
    expect(createdBy()).toEqual({ kind: "user", userId: "owner_1", name: "name-of(owner_1)" });
  });

  it("keeps the caller when the daemon says nothing (an older daemon)", async () => {
    await docsHandler.POST(adoptPost(APP_KEY, { ...FILE, adopt: true }));
    expect(createdBy()).toMatchObject({ kind: "agent", agent: { owner: "name-of(owner_1)", tool: null } });
  });

  it("ignores written_by outside adoption, and a malformed one", async () => {
    await docsHandler.POST(adoptPost(APP_KEY, { ...FILE, written_by: { agent: null } }));
    expect(createdBy().kind).toBe("agent");
    createDocument.mockClear();
    await docsHandler.POST(adoptPost(APP_KEY, { ...FILE, adopt: true, written_by: { agent: 7 } }));
    expect(createdBy()).toMatchObject({ kind: "agent", agent: { tool: null } });
  });

  it("never turns a signed-in person into someone else", async () => {
    await docsHandler.POST(adoptPost(OWNER, { ...FILE, adopt: true, written_by: { agent: "claude" } }));
    expect(createdBy()).toMatchObject({ kind: "user", userId: "owner_1" });
  });
});
