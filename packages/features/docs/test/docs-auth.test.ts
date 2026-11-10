import { describe, it, expect, vi, beforeEach } from "vitest";
import { CALLER_HEADER, serializeCaller, type Caller } from "@markbase/protocol/auth";

// From the caller header to an author, and from an author to a capability on
// one document. Nothing here authenticates — the gate did — so what is under
// test is that the handlers read exactly what the gate wrote, and that the one
// way in the gate does not know (a share-link guest) still works where the
// gate attached nobody.
//
// Two layers, tested as they are used: the handler layer reads the request
// (`credentialsFrom`), the server layer decides from what it was handed and
// never sees the request. The database is mocked at the three queries this
// path makes; the display name too, since it is a lookup of its own.

const getDocument = vi.fn();
const getLinkByToken = vi.fn();
const getMemberCapability = vi.fn();
const claimAgentSession = vi.fn();

vi.mock("../src/server/documents", () => ({ getDocument: (id: string) => getDocument(id) }));
vi.mock("../src/server/links", () => ({ getLinkByToken: (t: string) => getLinkByToken(t) }));
vi.mock("../src/server/members", () => ({
  getMemberCapability: (d: string, u: string) => getMemberCapability(d, u),
}));
vi.mock("../src/server/owner-name", () => ({
  ownerDisplayName: async (userId: string, email: string | null = null) =>
    email ? `name-of(${email})` : `name-of(${userId})`,
}));
vi.mock("@markbase/protocol", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@markbase/protocol")>()),
  claimAgentSession: (input: { token: string }) => claimAgentSession(input),
}));

const { resolveActor, requireDocCapability } = await import("../src/server/docs-auth");
const { credentialsFrom } = await import("../src/handlers/actor");

const DOC = { id: "doc_1", owner_id: "owner_1", content: "" };
const SESSION: Caller = { via: "session", ownerId: "owner_1", email: "o@example.com" };
const KEY: Caller = {
  via: "api_key",
  ownerId: "owner_1",
  key: { id: "key_1", provider: "claude_code", capability: "commenter" },
};

function req(caller: Caller | null, headers: Record<string, string> = {}): Request {
  return new Request("https://markbase.so/api/v1/docs/doc_1", {
    headers: caller ? { ...headers, [CALLER_HEADER]: serializeCaller(caller) } : headers,
  });
}

/** The request as the server layer sees it: read once, by the handler layer. */
const creds = (caller: Caller | null, headers: Record<string, string> = {}) =>
  credentialsFrom(req(caller, headers));

beforeEach(() => {
  getDocument.mockReset().mockResolvedValue(DOC);
  getLinkByToken.mockReset().mockResolvedValue(null);
  getMemberCapability.mockReset().mockResolvedValue(null);
  claimAgentSession.mockReset().mockResolvedValue(null);
});

describe("credentialsFrom — the request, read once", () => {
  it("reads the four headers and nothing else", () => {
    expect(
      creds(SESSION, { "x-mcp-session": "tok", "x-share-token": "share_1", "x-guest-name": "Ada" })
    ).toEqual({ caller: SESSION, sessionToken: "tok", shareToken: "share_1", guestName: "Ada" });
    expect(creds(null)).toEqual({
      caller: null,
      sessionToken: null,
      shareToken: null,
      guestName: null,
    });
  });

  it("refuses to guess at a header the gate could not have written", () => {
    // Only the gate writes this header, and it strips the namespace from every
    // incoming request. A value that is not a caller is a bug, not a stranger.
    const forged = new Request("https://markbase.so/api/v1/docs/doc_1", {
      headers: { [CALLER_HEADER]: "not json" },
    });
    expect(() => credentialsFrom(forged)).toThrow(CALLER_HEADER);
  });
});

describe("resolveActor — the caller, as an author", () => {
  it("is nobody when the gate attached nobody", async () => {
    await expect(resolveActor(creds(null))).resolves.toMatchObject({ ok: false, status: 401 });
  });

  it("names a session by its account, never by its address", async () => {
    await expect(resolveActor(creds(SESSION))).resolves.toEqual({
      ok: true,
      actor: { kind: "user", id: "owner_1", userId: "owner_1", name: "name-of(o@example.com)" },
    });
  });

  it("names a key as the owner's agent, and carries the key's ceiling", async () => {
    await expect(resolveActor(creds(KEY))).resolves.toEqual({
      ok: true,
      actor: {
        kind: "agent",
        id: "owner_1",
        userId: "owner_1",
        name: "name-of(owner_1)'s Claude Code",
        capabilityCap: "commenter",
      },
    });
  });

  it("claims an agent session under the key the header names", async () => {
    claimAgentSession.mockResolvedValue({ name: "Session Nine" });

    const res = await resolveActor(creds(KEY, { "x-mcp-session": "tok" }));

    expect(claimAgentSession).toHaveBeenCalledWith({
      ownerId: "owner_1",
      token: "tok",
      connectionId: "key_1",
    });
    expect(res).toMatchObject({ ok: true, actor: { name: "Session Nine" } });
  });
});

describe("requireDocCapability — the row decides", () => {
  it("the owner is the owner", async () => {
    await expect(requireDocCapability(creds(SESSION), "doc_1", "owner")).resolves.toMatchObject({
      ok: true,
      capability: "owner",
    });
  });

  it("a key's ceiling caps what its owner could do", async () => {
    const res = await requireDocCapability(creds(KEY), "doc_1", "editor");

    expect(res).toMatchObject({ ok: false, status: 403 });
  });

  it("a stranger with a cookie learns nothing about the document", async () => {
    const stranger: Caller = { via: "session", ownerId: "someone", email: null };

    await expect(requireDocCapability(creds(stranger), "doc_1", "viewer")).resolves.toMatchObject({
      ok: false,
      status: 404,
    });
  });

  it("admits an anonymous guest on a share token, at the link's capability", async () => {
    // The case the gate's `optional` mode exists for: no caller attached, and
    // the token is worth exactly what the link says.
    getLinkByToken.mockResolvedValue({ doc_id: "doc_1", mode: "guest", capability: "commenter" });

    const res = await requireDocCapability(
      creds(null, { "x-share-token": "share_1", "x-guest-name": "Ada" }),
      "doc_1",
      "commenter"
    );

    expect(res).toMatchObject({
      ok: true,
      actor: { kind: "guest", name: "Ada" },
      capability: "commenter",
    });
    expect(getLinkByToken).toHaveBeenCalledWith("share_1");
  });

  it("a guest token is worth nothing above its link", async () => {
    getLinkByToken.mockResolvedValue({ doc_id: "doc_1", mode: "guest", capability: "viewer" });

    const res = await requireDocCapability(
      creds(null, { "x-share-token": "share_1" }),
      "doc_1",
      "commenter"
    );

    expect(res).toMatchObject({ ok: false, status: 403 });
  });

  it("a guest token for another document, or a member link, opens nothing", async () => {
    getLinkByToken.mockResolvedValue({ doc_id: "doc_2", mode: "guest", capability: "viewer" });
    await expect(
      requireDocCapability(creds(null, { "x-share-token": "t" }), "doc_1", "viewer")
    ).resolves.toMatchObject({ ok: false, status: 401 });

    getLinkByToken.mockResolvedValue({ doc_id: "doc_1", mode: "member", capability: "editor" });
    await expect(
      requireDocCapability(creds(null, { "x-share-token": "t" }), "doc_1", "viewer")
    ).resolves.toMatchObject({ ok: false, status: 401 });
  });

  it("nobody, with no token, is refused as nobody", async () => {
    await expect(requireDocCapability(creds(null), "doc_1", "viewer")).resolves.toMatchObject({
      ok: false,
      status: 401,
    });
    expect(getLinkByToken).not.toHaveBeenCalled();
  });
});
