import { describe, it, expect, vi, beforeEach } from "vitest";
import { CALLER_HEADER, serializeCaller, type Caller } from "@markbase/protocol/auth";

// The Shared Vault's API surface (docs/shared-vault.md): the shared list says
// what the member holds and where they file it, a member may file or leave a
// share and the owner may not, and a document's viewer may fetch the media it
// references and nothing else in the owner's vault. The data layer is mocked
// at the seam the handlers call it through; what is under test is who gets
// through and what the handler makes of the answer.

const getDocument = vi.fn();
const listSharedDocumentsForUser = vi.fn();
const listDocumentsForUser = vi.fn();
const getMemberCapability = vi.fn();
const setMemberPath = vi.fn();
const removeMember = vi.fn();
const listAssets = vi.fn();
const getVault = vi.fn();

vi.mock("../src/server/documents", () => ({
  getDocument: (id: string) => getDocument(id),
  listSharedDocumentsForUser: (u: string, c: boolean) => listSharedDocumentsForUser(u, c),
  listDocumentsForUser: (u: string, v?: string, c?: boolean) => listDocumentsForUser(u, v, c),
}));
vi.mock("../src/server/members", () => ({
  getMemberCapability: (d: string, u: string) => getMemberCapability(d, u),
  setMemberPath: (d: string, u: string, p: string | null) => setMemberPath(d, u, p),
  removeMember: (d: string, u: string) => removeMember(d, u),
}));
vi.mock("../src/server/links", () => ({ getLinkByToken: async () => null }));
vi.mock("../src/server/owner-name", () => ({
  ownerDisplayName: async (userId: string) => (userId === "owner_1" ? "Ada" : `name-of(${userId})`),
}));
vi.mock("../src/server/assets", () => ({
  listAssets: (v: string) => listAssets(v),
  signAssetUrl: async (v: string, sha: string) => `https://signed/${v}/${sha}`,
}));
vi.mock("../src/server/vaults", () => ({
  getVault: (id: string) => getVault(id),
  userOwnsVault: async (id: string, userId: string) => {
    const v = (await getVault(id)) as { owner_id: string } | null;
    return v !== null && v.owner_id === userId;
  },
}));
vi.mock("@markbase/protocol", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@markbase/protocol")>()),
  claimAgentSession: async () => null,
}));

const { docsHandler, docMembershipHandler } = await import("../src/handlers/documents");
const { assetsHandler } = await import("../src/handlers/assets");

const DOC = {
  id: "doc_1",
  owner_id: "owner_1",
  vault_id: "vault_a",
  path: "notes/plan.md",
  content: "# Plan\n\n![d](img/diagram.png)\n![far](../shared/logo.png)\n![web](https://x/y.png)\n",
};
const OWNER: Caller = { via: "session", ownerId: "owner_1", email: "o@example.com" };
const MEMBER: Caller = { via: "session", ownerId: "user_2", email: "m@example.com" };
const MEMBER_KEY: Caller = {
  via: "api_key",
  ownerId: "user_2",
  key: { id: "key_2", provider: "claude_code", capability: null },
};

function req(
  caller: Caller | null,
  url: string,
  init: { method?: string; body?: string; headers?: Record<string, string> } = {}
): Request {
  const headers: Record<string, string> = { ...(init.headers ?? {}) };
  if (caller) headers[CALLER_HEADER] = serializeCaller(caller);
  if (init.body) headers["content-type"] = "application/json";
  return new Request(`https://markbase.so/api/v1${url}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body,
  });
}

beforeEach(() => {
  getDocument.mockReset().mockResolvedValue(DOC);
  getMemberCapability.mockReset().mockResolvedValue(null);
  setMemberPath.mockReset().mockResolvedValue(true);
  removeMember.mockReset().mockResolvedValue(true);
  listAssets.mockReset().mockResolvedValue([]);
  getVault.mockReset().mockResolvedValue({ id: "vault_a", owner_id: "owner_1" });
  listSharedDocumentsForUser.mockReset().mockResolvedValue([]);
  listDocumentsForUser.mockReset().mockResolvedValue([]);
});

describe("GET /docs?scope=shared", () => {
  const row = {
    id: "doc_1",
    title: "Plan: Q4",
    version: 3,
    owner_id: "owner_1",
    tab_group_id: "g1",
    position: 0,
    created_at: "2026-01-01",
    updated_at: "2026-01-02",
    path: "notes/plan.md",
    vault_id: "vault_a",
    capability: "viewer",
    member_path: null,
    has_crdt: true,
  };

  it("says what the member holds, and lays the document out by owner and title", async () => {
    listSharedDocumentsForUser.mockResolvedValue([row]);
    const res = await docsHandler.GET(req(MEMBER, "/docs?scope=shared"));
    expect(res.status).toBe(200);
    const { docs } = (await res.json()) as { docs: Array<Record<string, string | boolean | null>> };
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({
      id: "doc_1",
      capability: "viewer",
      owner_name: "Ada",
      // The member's path, not the owner's: the colon in the title is not a
      // filename character, so it becomes a dash.
      path: "Ada/Plan- Q4.md",
      member_path: null,
      owner_path: "notes/plan.md",
      has_crdt: true,
      vault_id: "vault_a",
    });
    expect(listSharedDocumentsForUser).toHaveBeenCalledWith("user_2", false);
  });

  it("uses the member's own path once they have filed it", async () => {
    listSharedDocumentsForUser.mockResolvedValue([{ ...row, member_path: "work/plan.md" }]);
    const res = await docsHandler.GET(req(MEMBER, "/docs?scope=shared&content=1"));
    const { docs } = (await res.json()) as { docs: Array<{ path: string; member_path: string }> };
    expect(docs[0].path).toBe("work/plan.md");
    expect(docs[0].member_path).toBe("work/plan.md");
    expect(listSharedDocumentsForUser).toHaveBeenCalledWith("user_2", true);
  });

  it("leaves the owned list exactly as it was", async () => {
    listDocumentsForUser.mockResolvedValue([{ ...row, capability: undefined }]);
    const res = await docsHandler.GET(req(OWNER, "/docs?vault=vault_a"));
    const { docs } = (await res.json()) as { docs: Array<Record<string, string>> };
    expect(docs[0].path).toBe("notes/plan.md");
    expect(docs[0]).not.toHaveProperty("owner_name");
    expect(listSharedDocumentsForUser).not.toHaveBeenCalled();
  });
});

describe("PATCH /docs/:id/membership", () => {
  it("files the document where the member says, in the member's row only", async () => {
    getMemberCapability.mockResolvedValue("viewer");
    const res = await docMembershipHandler.PATCH(
      req(MEMBER, "/docs/doc_1/membership", { method: "PATCH", body: JSON.stringify({ path: "/Work//plan.md" }) }),
      "doc_1"
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, path: "Work/plan.md" });
    expect(setMemberPath).toHaveBeenCalledWith("doc_1", "user_2", "Work/plan.md");
  });

  it("works for the member's daemon on its key, which is how a rename on disk arrives", async () => {
    getMemberCapability.mockResolvedValue("editor");
    const res = await docMembershipHandler.PATCH(
      req(MEMBER_KEY, "/docs/doc_1/membership", { method: "PATCH", body: JSON.stringify({ path: "a.md" }) }),
      "doc_1"
    );
    expect(res.status).toBe(200);
    expect(setMemberPath).toHaveBeenCalledWith("doc_1", "user_2", "a.md");
  });

  it("null returns the document to the default layout", async () => {
    getMemberCapability.mockResolvedValue("viewer");
    const res = await docMembershipHandler.PATCH(
      req(MEMBER, "/docs/doc_1/membership", { method: "PATCH", body: JSON.stringify({ path: null }) }),
      "doc_1"
    );
    expect(res.status).toBe(200);
    expect(setMemberPath).toHaveBeenCalledWith("doc_1", "user_2", null);
  });

  it("refuses the owner, who has no membership and a path of their own", async () => {
    const res = await docMembershipHandler.PATCH(
      req(OWNER, "/docs/doc_1/membership", { method: "PATCH", body: JSON.stringify({ path: "x.md" }) }),
      "doc_1"
    );
    expect(res.status).toBe(400);
    expect(setMemberPath).not.toHaveBeenCalled();
  });

  it("hides the document from a stranger", async () => {
    const res = await docMembershipHandler.PATCH(
      req(MEMBER, "/docs/doc_1/membership", { method: "PATCH", body: JSON.stringify({ path: "x.md" }) }),
      "doc_1"
    );
    expect(res.status).toBe(404);
  });

  it("rejects a body with no path", async () => {
    getMemberCapability.mockResolvedValue("viewer");
    const res = await docMembershipHandler.PATCH(
      req(MEMBER, "/docs/doc_1/membership", { method: "PATCH", body: "{}" }),
      "doc_1"
    );
    expect(res.status).toBe(400);
  });
});

describe("DELETE /docs/:id/membership", () => {
  it("lets a member leave — the document is untouched", async () => {
    getMemberCapability.mockResolvedValue("commenter");
    const res = await docMembershipHandler.DELETE(
      req(MEMBER, "/docs/doc_1/membership", { method: "DELETE" }),
      "doc_1"
    );
    expect(res.status).toBe(200);
    expect(removeMember).toHaveBeenCalledWith("doc_1", "user_2");
  });

  it("refuses the owner — leaving is not deleting", async () => {
    const res = await docMembershipHandler.DELETE(
      req(OWNER, "/docs/doc_1/membership", { method: "DELETE" }),
      "doc_1"
    );
    expect(res.status).toBe(400);
    expect(removeMember).not.toHaveBeenCalled();
  });
});

describe("GET /assets?doc=:id", () => {
  const vaultAssets = [
    { id: "a1", vault_id: "vault_a", path: "notes/img/diagram.png", sha256: "s1", size_bytes: 1, content_type: "image/png", owner_id: "owner_1", created_at: "" },
    { id: "a2", vault_id: "vault_a", path: "shared/logo.png", sha256: "s2", size_bytes: 1, content_type: "image/png", owner_id: "owner_1", created_at: "" },
    { id: "a3", vault_id: "vault_a", path: "private/secret.png", sha256: "s3", size_bytes: 1, content_type: "image/png", owner_id: "owner_1", created_at: "" },
  ];

  it("gives a viewer the assets the document references, resolved against the owner's path, and no others", async () => {
    getMemberCapability.mockResolvedValue("viewer");
    listAssets.mockResolvedValue(vaultAssets);
    const res = await assetsHandler.GET(req(MEMBER, "/assets?doc=doc_1"));
    expect(res.status).toBe(200);
    const { assets } = (await res.json()) as { assets: Array<{ path: string; url: string }> };
    expect(assets.map((a) => a.path).sort()).toEqual(["notes/img/diagram.png", "shared/logo.png"]);
    expect(assets[0].url).toMatch(/^https:\/\/signed\/vault_a\//);
    expect(listAssets).toHaveBeenCalledWith("vault_a");
  });

  it("hides the document — and so the vault's media — from a stranger", async () => {
    const res = await assetsHandler.GET(req(MEMBER, "/assets?doc=doc_1"));
    expect(res.status).toBe(404);
    expect(listAssets).not.toHaveBeenCalled();
  });

  it("still refuses a member the whole vault", async () => {
    getMemberCapability.mockResolvedValue("editor");
    const res = await assetsHandler.GET(req(MEMBER, "/assets?vault=vault_a"));
    expect(res.status).toBe(404);
  });

  it("answers 304 to the tag it gave, like the vault listing", async () => {
    getMemberCapability.mockResolvedValue("viewer");
    listAssets.mockResolvedValue(vaultAssets);
    const first = await assetsHandler.GET(req(MEMBER, "/assets?doc=doc_1&urls=0"));
    const etag = first.headers.get("etag") as string;
    expect(etag).toBeTruthy();
    const again = await assetsHandler.GET(
      req(MEMBER, "/assets?doc=doc_1&urls=0", { headers: { "if-none-match": etag } })
    );
    expect(again.status).toBe(304);
  });

  it("refuses vault and doc together, and neither", async () => {
    expect((await assetsHandler.GET(req(OWNER, "/assets?vault=vault_a&doc=doc_1"))).status).toBe(400);
    expect((await assetsHandler.GET(req(OWNER, "/assets"))).status).toBe(400);
  });
});
