import { describe, it, expect, vi, beforeEach } from "vitest";
import { CALLER_HEADER, serializeCaller, type Caller } from "@markbase/shared/auth";

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
const hasAgentConnection = vi.fn();

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
vi.mock("@markbase/server/api-keys", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@markbase/server/api-keys")>()),
  hasAgentConnection: (u: string) => hasAgentConnection(u),
}));
vi.mock("../src/server/members", () => ({
  getMemberCapability: async () => null,
  setMemberPath: async () => true,
  removeMember: async () => true,
}));
vi.mock("../src/server/links", () => ({ getLinkByToken: async () => null }));
vi.mock("../src/server/owner-name", () => ({ ownerDisplayName: async (u: string) => u }));
vi.mock("@markbase/server/db/agent-sessions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@markbase/server/db/agent-sessions")>()),
  claimAgentSession: async () => null,
}));

const { createVaultEndpoint, readVaultEndpoint, renameVaultEndpoint, deleteVaultEndpoint } = await import(
  "../src/handlers/vaults"
);
// The tests below call an endpoint the way a route does: its `handle`, with the
// path's parameters. These keep the call sites reading as method-on-resource.
const { ensureFirstVault } = await import("../src/server/first-vault");
const vaultsHandler = { POST: (r: Request) => createVaultEndpoint.handle(r, {}) };
const vaultHandler = {
  GET: (r: Request, id: string) => readVaultEndpoint.handle(r, { id }),
  PATCH: (r: Request, id: string) => renameVaultEndpoint.handle(r, { id }),
  DELETE: (r: Request, id: string) => deleteVaultEndpoint.handle(r, { id }),
};

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
  hasAgentConnection.mockReset().mockResolvedValue(false);
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
    expect(await res.json()).toEqual({
      vault: { id: "vault_new", name: "First Vault", owner_id: "user_2" },
      agent_connected: false,
    });
  });
});

// The app offers "Connect an agent" once, after a first vault. A person who
// added Markbase as a connector inside their AI app before making a vault has
// an agent already, and the answer rides on the vault so the app can skip it.
describe("POST /vaults says whether an agent is already connected", () => {
  it("true for a first vault on an account that has a connection", async () => {
    hasAgentConnection.mockResolvedValue(true);
    const res = await vaultsHandler.POST(postVault(OWNER, "First Vault"));
    expect(hasAgentConnection).toHaveBeenCalledWith("owner_1");
    expect((await res.json()).agent_connected).toBe(true);
  });

  it("false for a first vault on an account that has none", async () => {
    const res = await vaultsHandler.POST(postVault(OWNER, "First Vault"));
    expect((await res.json()).agent_connected).toBe(false);
  });

  it("false, and still 201, when the connection cannot be read: the offer is skippable", async () => {
    hasAgentConnection.mockRejectedValue(new Error("db down"));
    const res = await vaultsHandler.POST(postVault(OWNER, "First Vault"));
    expect(res.status).toBe(201);
    expect((await res.json()).agent_connected).toBe(false);
  });

  it("is not asked for a second vault, where nothing is offered", async () => {
    listVaultsForUser.mockResolvedValue([{ id: "vault_a", name: "Work", owner_id: "owner_1" }]);
    const res = await vaultsHandler.POST(postVault(OWNER, "Personal"));
    expect(hasAgentConnection).not.toHaveBeenCalled();
    expect(await res.json()).toEqual({ vault: { id: "vault_new", name: "Personal", owner_id: "owner_1" } });
  });
});

// A person who connects an agent before ever opening the app (a connector
// added inside an AI app, signing up on the way through) gets the same first
// vault the app's dialog makes: one vault, with the Welcome document in it.
describe("ensureFirstVault", () => {
  const row = (id: string, created_at: string) => ({ id, name: "My Vault", owner_id: "user_2", created_at });

  it("creates the first vault, with the Welcome document, for an account that has none", async () => {
    createVault.mockResolvedValue(row("vault_new", "2026-11-22T19:13:03Z"));
    listVaultsForUser.mockResolvedValueOnce([]).mockResolvedValueOnce([row("vault_new", "2026-11-22T19:13:03Z")]);
    const made = await ensureFirstVault("user_2");
    expect(made).toEqual({ vault: row("vault_new", "2026-11-22T19:13:03Z"), created: true });
    expect(createVault).toHaveBeenCalledWith({ name: "My Vault", owner_id: "user_2" });
    expect(seedWelcomeDoc).toHaveBeenCalledWith("user_2", "vault_new");
  });

  it("run again, changes nothing: the account keeps its vault and gets no second Welcome", async () => {
    listVaultsForUser.mockResolvedValue([row("vault_a", "2026-11-01T00:00:00Z")]);
    const again = await ensureFirstVault("user_2");
    expect(again).toEqual({ vault: row("vault_a", "2026-11-01T00:00:00Z"), created: false });
    expect(createVault).not.toHaveBeenCalled();
    expect(seedWelcomeDoc).not.toHaveBeenCalled();
  });

  it("keeps the vault when its Welcome cannot be seeded", async () => {
    createVault.mockResolvedValue(row("vault_new", "2026-11-22T19:13:03Z"));
    seedWelcomeDoc.mockRejectedValue(new Error("db down"));
    expect((await ensureFirstVault("user_2")).created).toBe(true);
  });

  // Two approvals at the same moment both find no vault and both create one.
  it("removes its own vault when another call's is older, and seeds nothing into either", async () => {
    const other = row("vault_other", "2026-11-22T19:13:03.100Z");
    const mine = row("vault_mine", "2026-11-22T19:13:03.200Z");
    createVault.mockResolvedValue(mine);
    listVaultsForUser.mockResolvedValueOnce([]).mockResolvedValueOnce([other, mine]);
    const made = await ensureFirstVault("user_2");
    expect(made).toEqual({ vault: other, created: false });
    expect(deleteVault).toHaveBeenCalledWith("vault_mine", "user_2");
    expect(seedWelcomeDoc).not.toHaveBeenCalled();
  });

  it("keeps its own vault when it is the older of the two", async () => {
    const mine = row("vault_mine", "2026-11-22T19:13:03.100Z");
    const other = row("vault_other", "2026-11-22T19:13:03.200Z");
    createVault.mockResolvedValue(mine);
    listVaultsForUser.mockResolvedValueOnce([]).mockResolvedValueOnce([mine, other]);
    expect(await ensureFirstVault("user_2")).toEqual({ vault: mine, created: true });
    expect(deleteVault).not.toHaveBeenCalled();
    expect(seedWelcomeDoc).toHaveBeenCalledWith("user_2", "vault_mine");
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
