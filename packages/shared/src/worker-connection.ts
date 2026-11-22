// Which identity is a runner?
//
// Not a machine. Claude Code and Codex on one laptop are two things that claim
// work; a laptop and a server are two more. Today every one of them reports
// only "owner 27cde99b…", and the consequences are already in the schema:
//
//   - public.workers is keyed `owner_id primary key`, and claim_next_job upserts
//     presence on EVERY poll. Two runners for one owner overwrite each other's
//     last_poll_at, so "is your worker connected?" answers for whichever polled
//     last and cannot say which — and a dead runner looks alive because its
//     partner is still polling.
//   - discover-repos.ts hard-codes `connectionId: null` into
//     reconcileAgentSessions. agent_sessions HAS a connection_id, referencing
//     api_keys(id); the runner is the one caller that never fills it in.
//
// The runner does not look this up itself. It holds a bearer token and talks to
// the API — never to the database — so it asks /api/v1/me, which already had to
// resolve that token to answer anything at all, and gets back the connection it
// authenticated as.
//
// Deliberately a decision with an injected fetch, so the failure modes below are
// choices rather than accidents, and so it can be tested without a server.

import { isProvider, type Provider } from "./agent-sessions";

/** Who a runner is: the connection it authenticated with, and whose work it runs. */
export interface WorkerConnection {
  /** api_keys.id — the identity presence and sessions should key on. */
  connectionId: string;
  /** Whose jobs this runner claims. */
  ownerId: string;
  /**
   * The owner's display name, for attributing what this runner syncs.
   *
   * The vault daemon holds a bearer token and nothing else — no owner id, no
   * name — yet a file you edited in Obsidian is YOUR edit and has to be recorded
   * as such. This endpoint already resolved the token, so it answers with the
   * name too. Null when the server is too old to send it, or the owner has no
   * resolvable name.
   */
  ownerName: string | null;
  /** What kind of agent this connection was minted for. */
  provider: Provider;
  /** The connection's display name, for logs and the presence UI. */
  name: string | null;
}

export interface ResolveConnectionDeps {
  /** Injected for tests; production uses the global fetch. */
  fetch?: typeof globalThis.fetch;
}

/** What /api/v1/me answers. Only the fields this needs. */
interface MeResponse {
  owner_id?: string | null;
  owner_name?: string | null;
  connection_id?: string | null;
  connection_name?: string | null;
  provider?: string | null;
}

/**
 * Ask the API which connection this token belongs to.
 *
 * Returns null rather than throwing, in every failure: a runner that cannot say
 * who it is must still claim work. Identity improves presence and session
 * bookkeeping; making it a precondition would turn an unreachable web app into
 * a worker that refuses to start.
 */
export async function resolveWorkerConnection(
  appUrl: string,
  apiKey: string,
  deps: ResolveConnectionDeps = {}
): Promise<WorkerConnection | null> {
  // Nothing to ask with. Short-circuited so a misconfigured runner does not
  // cost a round trip on every startup.
  if (!appUrl || !apiKey) return null;

  const doFetch = deps.fetch ?? globalThis.fetch;
  const url = `${appUrl.replace(/\/+$/, "")}/api/v1/me`;

  let body: MeResponse;
  try {
    const res = await doFetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
    // 401 (revoked, unconfirmed, wrong), 403 (no scope), or the app being down.
    // None of them is an identity, and none is worth stopping the runner over.
    if (!res.ok) return null;
    body = (await res.json()) as MeResponse;
  } catch {
    // Unreachable, or a body that is not JSON. See above: not fatal.
    return null;
  }

  // An admin session answers this endpoint too, with no connection behind it —
  // a person in a browser is not a runner. Without both ids there is no
  // identity to report, and inventing one is worse than having none.
  if (!body.connection_id || !body.owner_id) return null;

  return {
    connectionId: body.connection_id,
    ownerId: body.owner_id,
    ownerName: body.owner_name ?? null,
    // agent_sessions.provider is CHECK-constrained, so a value the database
    // would refuse must not be passed through to the insert that carries it.
    provider: isProvider(body.provider) ? body.provider : "unknown",
    name: body.connection_name ?? null,
  };
}
