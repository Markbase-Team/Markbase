import type { Caller } from "@markbase/protocol/auth";
import { ownerDisplayName } from "./owner-name";
import { agentLabel } from "@markbase/protocol/attribution";
import { claimAgentSession } from "@markbase/protocol";
import { docEndpoint } from "../logic/endpoints";
import {
  atLeast,
  capabilityFor,
  getDocument,
  getLinkByToken,
  getMemberCapability,
  type Actor,
  type Capability,
  type DocumentRow,
} from "./index";

// Who is calling a /api/v1/docs endpoint, as an author.
//
// Nothing here authenticates, and nothing here reads a request. The shell's
// gate resolved the session cookie or the API key before the request arrived,
// checked the key's scope against the method, and attached what it learned as
// the caller header — so a human and an agent reach the same endpoints and
// differ only in the recorded author. The handler layer reads that header,
// and the three others a request can carry, and hands this layer the values
// (see handlers/actor.ts — this layer is the database's, and knows no HTTP).
// This file turns them into an `Actor`, and, for a per-document endpoint, into
// a capability on the document. The gate answers *who*; only the row can
// answer *may they*.
//
// There is one more way in that the gate does not know: an anonymous guest on
// a share link, carrying a share token. The gate lets such a request through
// with no caller attached (the prefix is guarded in `optional` mode), and
// `requireDocCapability` is where that token is worth something.

/**
 * What a request said about who is asking — everything this layer needs, and
 * nothing about the request itself. The handler layer builds it from headers.
 */
export interface Credentials {
  /** The caller the gate attached, or null when it attached nobody. */
  caller: Caller | null;
  /** `X-MCP-Session`: an agent session token to author this action under. */
  sessionToken?: string | null;
  /** `X-Share-Token`: an anonymous guest's share link. */
  shareToken?: string | null;
  /** `X-Guest-Name`: what that guest asked to be called. */
  guestName?: string | null;
}

export type ResolvedActor =
  | { ok: true; actor: Actor }
  | { ok: false; status: number; error: string };

const NOBODY: ResolvedActor = {
  ok: false,
  status: 401,
  error:
    "Missing credentials. Sign in, or send 'Authorization: Bearer <api_key>'.",
};

export async function resolveActor(creds: Credentials): Promise<ResolvedActor> {
  const { caller } = creds;
  if (!caller) return NOBODY;

  if (caller.via === "session") {
    return {
      ok: true,
      actor: {
        kind: "user",
        id: caller.ownerId,
        userId: caller.ownerId,
        // A display name, not the raw email. This string is recorded as a
        // version's author INSIDE the Y.Doc, which replicates to everyone the
        // document is shared with — so an address here would hand a guest the
        // owner's email. Cached, so it costs no round trip on the hot path.
        name: await ownerDisplayName(caller.ownerId, caller.email),
      },
    };
  }

  // Session attribution: if the caller forwarded its session token, claim the
  // pending session (pending -> active) and author this action under the
  // session's name, so "which session did this" is answerable. Best-effort — an
  // unknown/dead token just falls back to the owner's agent label below.
  let name: string | null = null;
  if (creds.sessionToken) {
    try {
      const session = await claimAgentSession({
        ownerId: caller.ownerId,
        token: creds.sessionToken,
        connectionId: caller.key.id,
      });
      if (session) name = session.name;
    } catch {
      // attribution is advisory; never block the request over it
    }
  }
  // No named session: say whose agent this is — "Jessie's Claude Code". Built
  // from the OWNER plus the connection's stamped provider, never the key's
  // stored name, which for older keys is the approving browser's User-Agent.
  if (name === null) {
    name = agentLabel(await ownerDisplayName(caller.ownerId), caller.key.provider);
  }

  return {
    ok: true,
    actor: {
      kind: "agent",
      id: caller.ownerId,
      userId: caller.ownerId,
      name,
      // A key may carry a capability ceiling (agent access control).
      capabilityCap: caller.key.capability,
    },
  };
}

export type DocAuth =
  | { ok: true; actor: Actor; doc: DocumentRow; capability: Capability }
  | { ok: false; status: number; error: string };

// Enforce a route by its registry id — the endpoint's required capability
// comes from the single registry (packages/docs/src/endpoints.ts), so the role
// a route enforces and the role the skill documents can never drift. The
// registry's `scope` is not checked here: the gate holds a key to the scope
// its method implies, and every endpoint's scope agrees with its method.
export async function requireDocEndpoint(
  creds: Credentials,
  docId: string,
  endpointId: string
): Promise<DocAuth> {
  const ep = docEndpoint(endpointId);
  if (ep.capability === null) {
    // Account-level endpoints (list/create) aren't per-doc — use accountActor.
    throw new Error(`Endpoint '${endpointId}' is account-level, not per-doc.`);
  }
  return requireDocCapability(creds, docId, ep.capability);
}

// Resolve the actor AND check they hold at least `need` capability on the doc.
// Returns the loaded doc so handlers don't refetch.
export async function requireDocCapability(
  creds: Credentials,
  docId: string,
  need: Capability
): Promise<DocAuth> {
  // The doc doesn't depend on who's asking, so fetch it alongside the actor
  // rather than after — this is the first of the round trips that add up to a
  // slow document open. Both branches below await the same promise; the .catch
  // keeps a rejection from going unhandled when we bail before awaiting it.
  let docError: Error | null = null;
  const docPromise = getDocument(docId).catch((e: Error) => {
    docError = e;
    return null;
  });
  const loadDoc = async (): Promise<DocumentRow | null> => {
    const doc = await docPromise;
    if (docError) throw docError;
    return doc;
  };

  // 1. The caller the gate attached (session cookie or API key).
  const actorRes = await resolveActor(creds);
  if (actorRes.ok) {
    const [doc, memberCapability] = await Promise.all([
      loadDoc(),
      actorRes.actor.userId
        ? getMemberCapability(docId, actorRes.actor.userId)
        : Promise.resolve(null),
    ]);
    if (!doc) return { ok: false, status: 404, error: "Document not found." };
    const capability = capabilityFor({
      ownerId: doc.owner_id,
      actor: actorRes.actor,
      memberCapability,
      guestCapability: null,
    });
    if (capability === null || !atLeast(capability, need)) {
      return capability
        ? { ok: false, status: 403, error: "Insufficient permission." }
        : { ok: false, status: 404, error: "Document not found." };
    }
    return { ok: true, actor: actorRes.actor, doc, capability };
  }

  // 2. Anonymous guest via a share token, so guests hit the same endpoints as
  //    everyone else — capability just differs.
  if (creds.shareToken) {
    const link = await getLinkByToken(creds.shareToken);
    if (link && link.doc_id === docId && link.mode === "guest") {
      const doc = await loadDoc();
      if (!doc) return { ok: false, status: 404, error: "Document not found." };
      const name = (creds.guestName || "Guest").slice(0, 80);
      const actor: Actor = { kind: "guest", name };
      const capability = capabilityFor({
        ownerId: doc.owner_id,
        actor,
        memberCapability: null,
        guestCapability: link.capability,
      });
      if (capability === null || !atLeast(capability, need)) {
        return { ok: false, status: 403, error: "Insufficient permission." };
      }
      return { ok: true, actor, doc, capability };
    }
  }

  return { ok: false, status: actorRes.status, error: actorRes.error };
}
