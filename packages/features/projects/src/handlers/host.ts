import type { ApiScope } from "@markbase/node/api-keys";
import { callerFromHeaders } from "@markbase/protocol/auth";

/**
 * What every projects handler needs from whichever shell is serving it.
 *
 * Two things, and they are the two the shell genuinely owns: how a caller is
 * resolved and how a response is written. Everything else — the ownership
 * checks, the validation, the shape of the answer — is the feature's.
 *
 * Unlike the docs surface, nothing here sends CORS: these endpoints answer the
 * app and the worker, both same-origin or key-authenticated, and none of them
 * has an OPTIONS preflight today.
 */

/**
 * Who a handler is working for, or the refusal to return.
 *
 * Deliberately smaller than the gate's own `Caller`: a handler scopes by
 * `ownerId` and, for the worker's per-machine facts, by `keyId` (null for a
 * browser session — a person, not a runner). Nothing else about the key —
 * its name, its scopes, its prefix — is any handler's business.
 */
export type Authenticated =
  | { ok: true; ownerId: string; keyId: string | null }
  | { ok: false; status: number; error: string };

export interface HandlerHost {
  /** Resolve the caller from a session or a bearer key. */
  authenticate: (req: Request, need: ApiScope) => Promise<Authenticated>;
  /** Write a JSON response the way this surface must. */
  json: (data: unknown, status?: number) => Response;
}

/**
 * The host behind the shell's gate.
 *
 * Authentication happens once, in the proxy, before a request reaches any of
 * these prefixes (every one is guarded as `required`); what it learned rides
 * on the caller header, and this reads it back. The scope was enforced before
 * the header was written, so `need` is not re-checked here. A request with no
 * caller cannot normally reach a guarded route at all — the refusal below is
 * what a direct call outside the gate (a test, a misrouted deploy) sees.
 */
export const gateHost: HandlerHost = {
  authenticate: async (req) => {
    const caller = callerFromHeaders(req.headers);
    return caller
      ? {
          ok: true,
          ownerId: caller.ownerId,
          keyId: caller.via === "api_key" ? caller.key.id : null,
        }
      : { ok: false, status: 401, error: "Missing credentials." };
  },
  json: (data, status = 200) => Response.json(data, { status }),
};

/** Resolve the caller, or the refusal to return. Keeps each happy path flat. */
export async function owner(
  req: Request,
  need: ApiScope,
  { authenticate, json }: HandlerHost
): Promise<{ ownerId: string } | { error: Response }> {
  const auth = await authenticate(req, need);
  if (!auth.ok) return { error: json({ error: auth.error }, auth.status) };
  return { ownerId: auth.ownerId };
}

/**
 * The caller and the connection they came in on, for the handlers that need to
 * know WHICH key is asking and not only whose: the worker's presence, its
 * Claude version, and the sessions it discovered are facts about one machine.
 * `keyId` is null for a browser session — a person, not a runner.
 */
export async function connection(
  req: Request,
  need: ApiScope,
  { authenticate, json }: HandlerHost
): Promise<{ ownerId: string; keyId: string | null } | { error: Response }> {
  const auth = await authenticate(req, need);
  if (!auth.ok) return { error: json({ error: auth.error }, auth.status) };
  return { ownerId: auth.ownerId, keyId: auth.keyId };
}
