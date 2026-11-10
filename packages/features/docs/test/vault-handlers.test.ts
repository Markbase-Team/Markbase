import { describe, it, expect, vi, beforeEach } from "vitest";
import { CALLER_HEADER, serializeCaller, type Caller } from "@markbase/protocol/auth";

// One vault, asked about by id. The two refusals are different answers and
// stay different: 404 is "there is no such vault" and 403 is "there is, and it
// is not yours". A daemon holding that vault's folder does opposite things on
// the two — retires the folder of a vault that is gone, leaves the folder of a
// vault that is someone else's untouched — so a single "not found" for both
// (what this used to answer) left it unable to do either safely.

const getVault = vi.fn();
const renameVault = vi.fn();
const deleteVault = vi.fn();
const listVaultsForUser = vi.fn();
const createVault = vi.fn();
const seedWelcomeDoc = vi.fn();

vi.mock("../src/server/vaults", () => ({
  getVault: (id: string) => getVault(id),
  renameVault: (id: string, name: string) => renameVault(id, name),
  deleteVault: (id: string, owner: string) => deleteVault(id, owner),
  listVaultsForUser: (u: string) => listVaultsForUser(u),
  createVault: (input: { name: string; owner_id: string }) => createVault(input),
  convertFolderToVault: async () => null,
  ensureDefaultVault: async () => null,
  userOwnsVault: async (id: string, userId: string) => {
    const v = (await getVault(id)) as { owner_id: string } | null;
    return v !== null && v.owner_id === userId;
  },
}));
vi.mock("../src/server/welcome", () => ({
  seedWelcomeDoc: (u: string, v: string) => seedWelcomeDoc(u, v),
  WELCOME_DOC_PATH: "Welcome to Markbase.md",
}));
vi.mock("../src/server/members", () => ({
  getMemberCapability: async () => null,
  setMemberPath: async () => true,
  removeMember: async () => true,
}));
vi.mock("../src/server/links", () => ({ getLinkByToken: async () => null }));
vi.mock("../src/server/owner-name", () => ({ ownerDisplayName: async (u: string) => u }));
vi.mock("@markbase/protocol", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@markbase/protocol")>()),
  claimAgentSession: async () => null,
}));

const { vaultHandler, vaultsHandler } = await import("../src/handlers/vaults");

const OWNER: Caller = { via: "session", ownerId: "owner_1", email: "o@example.com" };
const OTHER: Caller = {
  via: "api_key",
  ownerId: "user_2",
  key: { id: "key_2", provider: "claude_code", capability: null },
};

function req(caller: Caller, method = "GET", body?: string): Request {
  const headers: Record<string, string> = { [CALLER_HEADER]: serializeCaller(caller) };
  if (body) headers["content-type"] = "application/json";
  return new Request("https://markbase.so/api/v1/vaults/vault_a", { method, headers, body });
}

beforeEach(() => {
  getVault.mockReset().mockImplementation(async (id: string) =>
    id === "vault_a" ? { id: "vault_a", name: "Work", owner_id: "owner_1" } : null
  );
  renameVault.mockReset().mockResolvedValue(undefined);
  deleteVault.mockReset().mockResolvedValue(undefined);
  listVaultsForUser.mockReset().mockResolvedValue([]);
  createVault.mockReset().mockImplementation(async (input) => ({ id: "vault_new", ...input }));
  seedWelcomeDoc.mockReset().mockResolvedValue(undefined);
});

function postVault(caller: Caller, name: string): Request {
  return new Request("https://markbase.so/api/v1/vaults", {
    method: "POST",
    headers: { [CALLER_HEADER]: serializeCaller(caller), "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
}

// A new account's first vault comes with a Welcome document in it. The shared
// welcome document this replaced was hard-deleted and left a dangling pointer,
// so every new account since had received nothing; and sign-in, where it used
// to be seeded, is not a moment that has a vault to put a document in.
describe("POST /vaults seeds the Welcome document", () => {
  it("into the account's first vault", async () => {
    const res = await vaultsHandler.POST(postVault(OTHER, "First Vault"));
    expect(res.status).toBe(201);
    expect(createVault).toHaveBeenCalledWith({ name: "First Vault", owner_id: "user_2" });
    expect(seedWelcomeDoc).toHaveBeenCalledWith("user_2", "vault_new");
  });

  // The browser creates a vault through the same handler, signed in with a
  // session rather than a key. The web New Vault modal used to refuse and
  // point at the Mac download, so a browser-only account (a team member on a
  // self-hosted instance) had no vault and no Welcome; now its first vault is
  // seeded exactly as one made from the desktop app.
  it("into a vault created from the browser, with a session", async () => {
    const res = await vaultsHandler.POST(postVault(OWNER, "Team wiki"));
    expect(res.status).toBe(201);
    expect(createVault).toHaveBeenCalledWith({ name: "Team wiki", owner_id: "owner_1" });
    expect(seedWelcomeDoc).toHaveBeenCalledWith("owner_1", "vault_new");
  });

  it("not into a second one", async () => {
    listVaultsForUser.mockResolvedValue([{ id: "vault_a", name: "Work", owner_id: "owner_1" }]);
    const res = await vaultsHandler.POST(postVault(OWNER, "Personal"));
    expect(res.status).toBe(201);
    expect(seedWelcomeDoc).not.toHaveBeenCalled();
  });

  it("still answers 201 when the welcome cannot be seeded — the vault exists", async () => {
    seedWelcomeDoc.mockRejectedValue(new Error("db down"));
    const res = await vaultsHandler.POST(postVault(OTHER, "First Vault"));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ vault: { id: "vault_new", name: "First Vault", owner_id: "user_2" } });
  });
});

describe("GET /vaults/:id", () => {
  it("answers the owner with the vault, owner_id included", async () => {
    const res = await vaultHandler.GET(req(OWNER), "vault_a");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ vault: { id: "vault_a", name: "Work", owner_id: "owner_1" } });
  });

  it("is 403 for someone else's vault — it exists, it is not theirs", async () => {
    const res = await vaultHandler.GET(req(OTHER), "vault_a");
    expect(res.status).toBe(403);
  });

  it("is 404 for a vault that does not exist, whoever asks", async () => {
    expect((await vaultHandler.GET(req(OWNER), "vault_gone")).status).toBe(404);
    expect((await vaultHandler.GET(req(OTHER), "vault_gone")).status).toBe(404);
  });
});

describe("PATCH and DELETE /vaults/:id", () => {
  it("refuse someone else's vault with 403 and change nothing", async () => {
    const patched = await vaultHandler.PATCH(req(OTHER, "PATCH", JSON.stringify({ name: "Mine now" })), "vault_a");
    expect(patched.status).toBe(403);
    expect(renameVault).not.toHaveBeenCalled();
    const deleted = await vaultHandler.DELETE(req(OTHER, "DELETE"), "vault_a");
    expect(deleted.status).toBe(403);
    expect(deleteVault).not.toHaveBeenCalled();
  });

  it("answer 404 for a vault that is gone", async () => {
    expect((await vaultHandler.PATCH(req(OWNER, "PATCH", JSON.stringify({ name: "x" })), "vault_gone")).status).toBe(404);
    expect((await vaultHandler.DELETE(req(OWNER, "DELETE"), "vault_gone")).status).toBe(404);
  });

  it("still work for the owner", async () => {
    expect((await vaultHandler.PATCH(req(OWNER, "PATCH", JSON.stringify({ name: "Renamed" })), "vault_a")).status).toBe(200);
    expect(renameVault).toHaveBeenCalledWith("vault_a", "Renamed");
    expect((await vaultHandler.DELETE(req(OWNER, "DELETE"), "vault_a")).status).toBe(200);
    expect(deleteVault).toHaveBeenCalledWith("vault_a", "owner_1");
  });
});
