import { callerFromHeaders } from "@markbase/protocol/auth";
import {
  requireDocCapability as requireDocCapabilityFor,
  requireDocEndpoint as requireDocEndpointFor,
  resolveActor,
  type Capability,
  type Credentials,
  type DocAuth,
} from "../server";
import { json } from "./respond";

// The one place a request is read for who is asking.
//
// The gate attached the caller as a header; a request may also carry an agent
// session token and, for a share-link guest, a share token and a name. Those
// four headers are read here, once, into a `Credentials` value, and the
// server layer — the database's, which knows no HTTP — is handed that. The
// caller header is read through @markbase/protocol/auth, never as a raw
// string: the names have one definition and one writer, and a feature
// reaching for the raw header is a feature that can be handed a forged one.

/** What this request says about who is asking. Throws on a caller header the gate could not have written. */
export function credentialsFrom(req: Request): Credentials {
  return {
    caller: callerFromHeaders(req.headers),
    sessionToken: req.headers.get("x-mcp-session"),
    shareToken: req.headers.get("x-share-token"),
    guestName: req.headers.get("x-guest-name"),
  };
}

/** Enforce a per-document route by its registry id. */
export function requireDocEndpoint(
  req: Request,
  docId: string,
  endpointId: string
): Promise<DocAuth> {
  return requireDocEndpointFor(credentialsFrom(req), docId, endpointId);
}

/** Resolve the actor and check they hold at least `need` on the document. */
export function requireDocCapability(
  req: Request,
  docId: string,
  need: Capability
): Promise<DocAuth> {
  return requireDocCapabilityFor(credentialsFrom(req), docId, need);
}

/**
 * The caller of an account-level endpoint, or the refusal to return.
 *
 * Account-level means "not about one document", so there is no capability to
 * check — only that the gate attached somebody with a user to scope by. The
 * docs prefix is guarded in `optional` mode, so "nobody" does reach here: a
 * stranger may hold a share token, but a share token names a document, and
 * these endpoints are about none. Returning the refusal rather than throwing
 * keeps each handler's happy path flat.
 */
export async function accountActor(
  req: Request
): Promise<{ userId: string } | { error: Response }> {
  const a = await resolveActor(credentialsFrom(req));
  if (!a.ok) return { error: json({ error: a.error }, a.status) };
  if (!a.actor.userId) return { error: json({ error: "No user." }, 403) };
  return { userId: a.actor.userId };
}
