import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { CALLER_HEADER, parseCaller } from "@markbase/protocol/auth";

// The gate. Two channels reach one API, and everything behind /api/v1/terms
// trusts that a request which got there was already authenticated — so the
// things that must hold are: a refusal is a refusal, a cookie write from
// another site is refused, and the identity header cannot be supplied by the
// caller.
//
// `resolveCaller` is mocked: which credential wins is tested at its own level
// (packages/core/node/test/caller.test.ts). What is under test here is what the
// proxy does with the answer. `offersToken` and `forwardedCaller` are the real
// ones: whether a token was offered is read off the request, and what a key is
// reduced to on the header is part of what is being proved here.

const resolveCaller = vi.fn();
vi.mock("@markbase/node/caller", async () => {
  const real =
    await vi.importActual<typeof import("@markbase/node/caller")>(
      "@markbase/node/caller"
    );
  return {
    forwardedCaller: real.forwardedCaller,
    offersToken: real.offersToken,
    resolveCaller: (...a: Parameters<typeof real.resolveCaller>) =>
      resolveCaller(...a),
  };
});
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: null } }) },
  }),
}));
vi.mock("@/lib/supabase/middleware", () => ({
  updateSession: vi.fn(),
}));

const { proxy, guard } = await import("@/proxy");

const SESSION = {
  ok: true,
  via: "session",
  ownerId: "owner_1",
  email: "owner@example.com",
};
const KEY = {
  ok: true,
  via: "api_key",
  ownerId: "owner_1",
  key: {
    id: "key_1",
    name: "laptop",
    key_prefix: "jsk_abcdefgh",
    scopes: ["read", "write"],
    provider: "claude_code",
    capability: "commenter",
  },
};
const NOBODY = { ok: false, status: 401, error: "Missing credentials." };
const BAD_KEY = { ok: false, status: 401, error: "Invalid API key." };

function req(
  path = "/api/v1/terms",
  init: { method?: string; headers?: Record<string, string> } = {}
) {
  return new NextRequest(`https://markbase.so${path}`, {
    method: init.method ?? "GET",
    headers: init.headers,
  });
}

/** The request headers the proxy handed upstream, as Next encodes them. */
function forwarded(res: Response): Headers {
  const raw = res.headers.get("x-middleware-override-headers");
  const out = new Headers();
  for (const name of (raw ?? "").split(",").filter(Boolean)) {
    const v = res.headers.get(`x-middleware-request-${name.trim()}`);
    if (v !== null) out.set(name.trim(), v);
  }
  return out;
}

/** The caller the handler will read, or null when none was attached. */
function callerSeen(res: Response) {
  const v = forwarded(res).get(CALLER_HEADER);
  return v === null ? null : parseCaller(v);
}

beforeEach(() => {
  resolveCaller.mockReset();
  resolveCaller.mockResolvedValue(SESSION);
});

describe("proxy — the auth gate in front of /api/v1/terms", () => {
  it("passes an authenticated read through, with the caller attached", async () => {
    const res = await proxy(req());

    expect(res.status).toBe(200);
    expect(callerSeen(res)).toEqual({
      via: "session",
      ownerId: "owner_1",
      email: "owner@example.com",
    });
  });

  it("tells the feature what it needs about a key, and nothing more", async () => {
    resolveCaller.mockResolvedValue(KEY);

    const res = await proxy(req());

    // The id (to claim an agent session under), the provider (to name the
    // agent) and the ceiling (to cap it). Not the name, not the prefix, not
    // the scopes — the gate already enforced the scope.
    expect(callerSeen(res)).toEqual({
      via: "api_key",
      ownerId: "owner_1",
      key: { id: "key_1", provider: "claude_code", capability: "commenter" },
    });
  });

  it("refuses when neither channel produced anyone", async () => {
    resolveCaller.mockResolvedValue(NOBODY);

    const res = await proxy(req());

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({ error: "Missing credentials." });
  });

  it("drops every x-markbase-* header the caller sent, not just the one it sets", async () => {
    // `x-markbase-caller` would be overwritten anyway. The strip is for the
    // rest of the namespace: a name a handler reads tomorrow must not be one a
    // caller could supply today.
    const res = await proxy(
      req("/api/v1/terms", {
        headers: {
          [CALLER_HEADER]: JSON.stringify({ via: "session", ownerId: "someone_else" }),
          "x-markbase-capability": "owner",
        },
      })
    );

    expect(callerSeen(res)?.ownerId).toBe("owner_1");
    expect(forwarded(res).get("x-markbase-capability")).toBeNull();
  });

  it("refuses a cookie-authenticated write that came from another site", async () => {
    const res = await proxy(
      req("/api/v1/terms", { method: "POST", headers: { "sec-fetch-site": "cross-site" } })
    );

    expect(res.status).toBe(403);
  });

  it("allows the same write from our own pages", async () => {
    const res = await proxy(
      req("/api/v1/terms", { method: "POST", headers: { "sec-fetch-site": "same-origin" } })
    );

    expect(res.status).toBe(200);
  });

  it("lets a bearer write through from anywhere — a header nobody else can set", async () => {
    // The CLI, and the desktop app's local pages, are cross-site by definition.
    resolveCaller.mockResolvedValue(KEY);

    const res = await proxy(
      req("/api/v1/terms", { method: "POST", headers: { "sec-fetch-site": "cross-site" } })
    );

    expect(res.status).toBe(200);
  });

  it("falls back to Origin when the browser sent no Sec-Fetch-Site", async () => {
    const res = await proxy(
      req("/api/v1/terms", { method: "POST", headers: { origin: "https://evil.example" } })
    );

    expect(res.status).toBe(403);
  });

  it("asks for a write scope on a write and a read scope on a read", async () => {
    await proxy(req("/api/v1/terms"));
    expect(resolveCaller.mock.calls[0][1]).toBe("read");

    await proxy(req("/api/v1/terms", { method: "DELETE", headers: { "sec-fetch-site": "same-origin" } }));
    expect(resolveCaller.mock.calls[1][1]).toBe("write");
  });

  it("answers a preflight without asking who is calling", async () => {
    const res = await proxy(req("/api/v1/terms", { method: "OPTIONS" }));

    expect(res.status).toBe(204);
    expect(resolveCaller).not.toHaveBeenCalled();
  });

  it("leaves an unguarded API route alone", async () => {
    // The shell's own routes still authenticate in their handlers; every
    // feature prefix is guarded now.
    const res = await proxy(req("/api/v1/me"));

    expect(res.status).toBe(200);
    expect(resolveCaller).not.toHaveBeenCalled();
    expect(callerSeen(res)).toBeNull();
  });
});

// The mode a prefix with a third way in needs. /api/v1/docs is guarded in it:
// share-link guests reach a document's endpoints with X-Share-Token and no
// credential the gate knows, and the feature decides what the token is worth.
describe("proxy — /api/v1/docs is guarded in optional mode", () => {
  const optional = (r: NextRequest) => proxy(r);

  it("establishes the caller when a credential is offered, as required does", async () => {
    const res = await optional(req("/api/v1/docs/doc_1"));

    expect(res.status).toBe(200);
    expect(callerSeen(res)?.ownerId).toBe("owner_1");
  });

  it("lets a request that offered nothing through, with no caller attached", async () => {
    // A share-link guest: no cookie that resolves, no bearer. The feature
    // decides what the X-Share-Token it carries is worth.
    resolveCaller.mockResolvedValue(NOBODY);

    const res = await optional(req("/api/v1/docs/doc_1", { headers: { "x-share-token": "t" } }));

    expect(res.status).toBe(200);
    expect(callerSeen(res)).toBeNull();
  });

  it("lets an anonymous write through too — a guest can comment", async () => {
    resolveCaller.mockResolvedValue(NOBODY);

    const res = await optional(
      req("/api/v1/docs/doc_1/comments", { method: "POST", headers: { "sec-fetch-site": "same-origin" } })
    );

    expect(res.status).toBe(200);
  });

  it("still strips the namespace from an anonymous request", async () => {
    // Otherwise "optional" would be the mode in which anyone is anyone.
    resolveCaller.mockResolvedValue(NOBODY);

    const res = await optional(
      req("/api/v1/docs/doc_1", {
        headers: { [CALLER_HEADER]: JSON.stringify({ via: "session", ownerId: "owner_1" }) },
      })
    );

    expect(res.status).toBe(200);
    expect(callerSeen(res)).toBeNull();
  });

  it("still refuses a bearer token that was offered and is wrong", async () => {
    // A bad key is not "nobody". Falling through to anonymous would make a
    // typo'd key look like it worked, right up to the first 403.
    resolveCaller.mockResolvedValue(BAD_KEY);

    const res = await optional(
      req("/api/v1/docs/doc_1", { headers: { authorization: "Bearer jsk_wrong" } })
    );

    expect(res.status).toBe(401);
    expect(forwarded(res).get(CALLER_HEADER)).toBeNull();
  });

  it("refuses a key that lacks the scope, whatever the mode", async () => {
    resolveCaller.mockResolvedValue({
      ok: false,
      status: 403,
      error: "This API key lacks the 'write' scope.",
    });

    const res = await optional(
      req("/api/v1/docs/doc_1/edits", { method: "POST", headers: { "x-api-key": "jsk_readonly" } })
    );

    expect(res.status).toBe(403);
  });

  it("still refuses a cross-site cookie write", async () => {
    const res = await optional(
      req("/api/v1/docs/doc_1/edits", { method: "POST", headers: { "sec-fetch-site": "cross-site" } })
    );

    expect(res.status).toBe(403);
  });

  it("answers a preflight the same way", async () => {
    const res = await optional(req("/api/v1/docs/doc_1", { method: "OPTIONS" }));

    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(resolveCaller).not.toHaveBeenCalled();
  });

  it("is the mode's own definition too, not only the prefix's", async () => {
    // `guard` is exported so a mode can be proved before a prefix uses it.
    resolveCaller.mockResolvedValue(NOBODY);

    const res = await guard(req("/api/v1/anything"), "optional");

    expect(res.status).toBe(200);
    expect(callerSeen(res)).toBeNull();
  });
});

// The docs package also serves these two prefixes. They are account-level —
// a share token names a document, and these are about none — so a stranger
// has no business there, and the gate says so before any handler runs. Until
// now each handler said it itself.
describe("proxy — /api/v1/vaults and /api/v1/assets are guarded, required", () => {
  it.each(["/api/v1/vaults", "/api/v1/vaults/v_1", "/api/v1/assets?vault=v_1"])(
    "refuses an anonymous %s",
    async (path) => {
      resolveCaller.mockResolvedValue(NOBODY);

      const res = await proxy(req(path));

      expect(res.status).toBe(401);
    }
  );

  it("passes an authenticated vault write through with the caller attached", async () => {
    const res = await proxy(
      req("/api/v1/vaults", { method: "POST", headers: { "sec-fetch-site": "same-origin" } })
    );

    expect(res.status).toBe(200);
    expect(callerSeen(res)?.ownerId).toBe("owner_1");
  });
});
