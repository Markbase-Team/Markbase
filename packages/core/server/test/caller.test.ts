import { describe, it, expect, vi, beforeEach } from "vitest";

// Which credential wins when a request carries both.
//
// The order is the security property, not a preference: an API key carries a
// capability ceiling and a cookie session does not, so resolving a keyed
// request as its session widens a machine that was deliberately capped. The
// desktop app makes this the ordinary case — its window is signed in to the
// site AND its local pages hold a key.
//
// `verifyApiKey` is mocked because what is under test is which branch runs,
// not whether a hash matches; `readSession` needs no mock, it is injected.

const verifyApiKey = vi.fn();
vi.mock("../src/api-keys", () => ({ verifyApiKey: (t: string) => verifyApiKey(t) }));
vi.mock("@markbase/protocol", () => ({
  setConnectionProvider: vi.fn(async () => {}),
  providerFromClient: () => "claude_code",
}));

const { resolveCaller } = await import("../src/caller");

const CAPPED_KEY = {
  id: "key_1",
  owner_id: "owner_from_key",
  scopes: ["read", "write"],
  capability: "commenter",
  provider: "claude_code",
};

const session = async () => ({ id: "owner_from_session", email: "her@example.com" });
const noSession = async () => null;

function req(headers: Record<string, string> = {}): Request {
  return new Request("https://markbase.so/api/v1/terms", { headers });
}

beforeEach(() => {
  verifyApiKey.mockReset();
  verifyApiKey.mockResolvedValue(CAPPED_KEY);
});

describe("resolveCaller — two channels, one identity", () => {
  it("prefers the key when a request carries both, so the ceiling survives", async () => {
    // The desktop case. Under the old session-first order this came back as
    // the session — i.e. a key capped at commenter reading as full owner.
    const caller = await resolveCaller(req({ authorization: "Bearer jsk_x" }), "read", session);

    expect(caller).toMatchObject({ ok: true, via: "api_key", ownerId: "owner_from_key" });
  });

  it("falls to the cookie when no token was sent, without a key lookup", async () => {
    const caller = await resolveCaller(req(), "read", session);

    expect(caller).toMatchObject({ ok: true, via: "session", ownerId: "owner_from_session" });
    // The whole cost argument for the old ordering: a cookie-only request still
    // never pays for a key lookup.
    expect(verifyApiKey).not.toHaveBeenCalled();
  });

  it("refuses a bad token rather than falling through to the session", async () => {
    verifyApiKey.mockResolvedValue(null);

    const caller = await resolveCaller(req({ authorization: "Bearer jsk_wrong" }), "read", session);

    expect(caller).toMatchObject({ ok: false, status: 401 });
  });

  it("refuses a key that lacks the scope, even for a signed-in owner", async () => {
    // The sharpest form of the ceiling: the person IS the owner, and their
    // session would say yes. The key they chose to send says no, and it wins.
    verifyApiKey.mockResolvedValue({ ...CAPPED_KEY, scopes: ["read"] });

    const caller = await resolveCaller(req({ authorization: "Bearer jsk_x" }), "write", session);

    expect(caller).toMatchObject({ ok: false, status: 403 });
  });

  it("reads X-Api-Key as a token too", async () => {
    const caller = await resolveCaller(req({ "x-api-key": "jsk_x" }), "read", noSession);

    expect(caller).toMatchObject({ ok: true, via: "api_key" });
  });

  it("refuses when neither channel produced anyone", async () => {
    const caller = await resolveCaller(req(), "read", noSession);

    expect(caller).toMatchObject({ ok: false, status: 401 });
  });
});
