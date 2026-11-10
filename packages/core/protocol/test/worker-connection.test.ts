import { describe, it, expect, vi } from "vitest";
import { resolveWorkerConnection } from "../src/worker-connection";

// Which identity is a runner?
//
// A machine is not one. Claude Code and Codex on this laptop are two things
// that claim work, and a laptop and a server are two more — and today every one
// of them says only "owner 27cde99b…". The consequences are already visible:
//
//   - public.workers is keyed `owner_id primary key`, and claim_next_job upserts
//     presence on EVERY poll. Two runners for one owner overwrite each other's
//     last_poll_at, so the dashboard's "worker connected" card reports whichever
//     polled last and cannot say which, and a dead runner looks alive because
//     its partner is still polling.
//   - discover-repos.ts passes `connectionId: null` into reconcileAgentSessions,
//     hard-coded. agent_sessions HAS a connection_id column, referencing
//     api_keys(id); the runner is the one caller that never fills it in.
//
// The runner asks the API rather than the database — it holds a bearer token
// and that is the only thing it should need. /api/v1/me already resolves that
// token to answer at all, so it can say which connection it resolved to.
//
// These drive that decision with an injected fetch: "the server said X" is a
// choice the test makes, not a server it has to stand up.

/** A fetch that answers with one JSON body, and records what it was asked. */
function jsonFetch(status: number, body: unknown) {
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as Response;
  });
}

const OWNER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const CONN = "11111111-1111-1111-1111-111111111111";

describe("resolveWorkerConnection", () => {
  it("asks /api/v1/me with the bearer token, and reports what it answers", async () => {
    const fetchImpl = jsonFetch(200, {
      owner_id: OWNER,
      connection_id: CONN,
      connection_name: "MacBook — Claude Code",
      provider: "claude_code",
    });

    const conn = await resolveWorkerConnection("https://markbase.so", "jsk_live", {
      fetch: fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledWith("https://markbase.so/api/v1/me", {
      headers: { Authorization: "Bearer jsk_live" },
    });
    expect(conn).toEqual({
      connectionId: CONN,
      ownerId: OWNER,
      ownerName: null,
      provider: "claude_code",
      name: "MacBook — Claude Code",
    });
  });

  it("gives two runners on one machine two identities", async () => {
    // The whole point of keying on the connection rather than the owner: these
    // are separate api_keys rows, and each should report its own presence
    // instead of overwriting the other's.
    const code = await resolveWorkerConnection("https://x", "k1", {
      fetch: jsonFetch(200, { owner_id: OWNER, connection_id: "c1", provider: "claude_code" }),
    });
    const codex = await resolveWorkerConnection("https://x", "k2", {
      fetch: jsonFetch(200, { owner_id: OWNER, connection_id: "c2", provider: "codex" }),
    });

    expect(code?.ownerId).toBe(codex?.ownerId); // same owner
    expect(code?.connectionId).not.toBe(codex?.connectionId); // different runners
    expect([code?.provider, codex?.provider]).toEqual(["claude_code", "codex"]);
  });

  it("trims a trailing slash rather than asking for //api/v1/me", async () => {
    const fetchImpl = jsonFetch(200, { owner_id: OWNER, connection_id: CONN });
    await resolveWorkerConnection("https://markbase.so/", "k", { fetch: fetchImpl });
    expect(fetchImpl.mock.calls[0][0]).toBe("https://markbase.so/api/v1/me");
  });

  it("reports no identity for an admin session, which is a person not a runner", async () => {
    // The same endpoint answers a cookie session, with no connection behind it.
    // Inventing one would give every browser tab a runner identity.
    const conn = await resolveWorkerConnection("https://x", "k", {
      fetch: jsonFetch(200, { owner_id: OWNER, via: "admin", connection_id: null, provider: null }),
    });
    expect(conn).toBeNull();
  });

  it("returns null on 401, rather than inventing an identity", async () => {
    // Revoked, unconfirmed, or simply wrong.
    const conn = await resolveWorkerConnection("https://x", "jsk_revoked", {
      fetch: jsonFetch(401, { error: "Invalid API key." }),
    });
    expect(conn).toBeNull();
  });

  it("returns null on 403, when the key lacks the read scope", async () => {
    const conn = await resolveWorkerConnection("https://x", "k", {
      fetch: jsonFetch(403, { error: "This API key lacks the 'read' scope." }),
    });
    expect(conn).toBeNull();
  });

  it("survives an unreachable server, because identity is not worth stopping for", async () => {
    // The web app being down must not stop a runner from claiming work. It
    // loses its connection identity for this run; it does not die.
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    await expect(
      resolveWorkerConnection("https://x", "k", { fetch: fetchImpl as unknown as typeof fetch })
    ).resolves.toBeNull();
  });

  it("survives a body that is not JSON", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error("Unexpected token < in JSON");
      },
    }) as unknown as Response);
    await expect(
      resolveWorkerConnection("https://x", "k", { fetch: fetchImpl as unknown as typeof fetch })
    ).resolves.toBeNull();
  });

  it("asks nothing when it has no url or no key", async () => {
    const fetchImpl = jsonFetch(200, { owner_id: OWNER, connection_id: CONN });
    expect(await resolveWorkerConnection("", "k", { fetch: fetchImpl })).toBeNull();
    expect(await resolveWorkerConnection("https://x", "", { fetch: fetchImpl })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("treats an unrecognised provider as unknown rather than passing it through", async () => {
    // agent_sessions.provider is CHECK-constrained; a row carrying a provider
    // the database refuses would fail the insert that carries it.
    const conn = await resolveWorkerConnection("https://x", "k", {
      fetch: jsonFetch(200, {
        owner_id: OWNER,
        connection_id: CONN,
        provider: "some-new-agent",
      }),
    });
    expect(conn?.provider).toBe("unknown");
  });

  it("tolerates a server too old to send the connection name", async () => {
    const conn = await resolveWorkerConnection("https://x", "k", {
      fetch: jsonFetch(200, { owner_id: OWNER, connection_id: CONN, provider: "codex" }),
    });
    expect(conn?.name).toBeNull();
    expect(conn?.connectionId).toBe(CONN);
  });

  // The vault daemon holds a bearer token and nothing else — no owner id, no
  // name. It has to attribute a file you edited in Obsidian to YOU, so the one
  // endpoint that already resolves the token answers who the owner is, by name.
  it("learns the owner's display name, so a file edit can be attributed", async () => {
    const conn = await resolveWorkerConnection("https://x", "k", {
      fetch: jsonFetch(200, {
        owner_id: OWNER,
        owner_name: "Jessie",
        connection_id: CONN,
        provider: "claude_code",
      }),
    });
    expect(conn?.ownerName).toBe("Jessie");
  });

  it("tolerates a server too old to send the owner's name", async () => {
    const conn = await resolveWorkerConnection("https://x", "k", {
      fetch: jsonFetch(200, { owner_id: OWNER, connection_id: CONN }),
    });
    expect(conn?.ownerName).toBeNull();
    expect(conn?.connectionId).toBe(CONN);
  });
});
