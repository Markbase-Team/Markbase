import { callerFromHeaders } from "./auth";
/**
 * The contract a route handler and its host agree on.
 *
 * Types only, and deliberately in protocol rather than beside the
 * implementation in @markbase/node: a feature's `handlers/` layer must be able to
 * state what it needs from its host without pulling in how a particular host
 * satisfies it. The implementation lives in `@markbase/node/caller`, and a
 * shell that resolves callers some other way is free to supply its own.
 *
 * There is ONE API. A handler never learns whether the caller arrived with a
 * browser session or a bearer token — it receives `ownerId` and scopes by it.
 */

/** What a request wants to do. Writes need a key that was granted writes. */
export type CallerScope = "read" | "write";

/** Who the caller is: whose data this request may reach. */
export type Authorized = { ok: true; ownerId: string };

/** Why the caller was turned away, and with what status. */
export type Refused = { ok: false; status: number; error: string };

/**
 * What a handler asks its host: who is this, and may they do `need`?
 *
 * Taking the request is what lets one implementation serve both credentials —
 * the host reads its own session from ambient state, and the bearer token off
 * these headers.
 */
export type Authorize = (
  req: Request,
  need: CallerScope
) => Promise<Authorized | Refused>;

/**
 * An `Authorize` for a handler behind the gate.
 *
 * The gate in the shell's proxy has already resolved the caller and attached
 * it as a header; this reads that back into the shape the injected handlers
 * were written against, so a feature moves behind the gate without its
 * handlers changing first. `need` is ignored on purpose: the gate decided it
 * from the method before the request got here. A missing header behind a
 * `required` prefix is a routing bug, reported as a refusal rather than as
 * an anonymous caller.
 */
export const authorizedByGate: Authorize = async (req) => {
  const caller = callerFromHeaders(req.headers);
  if (!caller) {
    return {
      ok: false,
      status: 401,
      error: "Missing credentials. Sign in, or send 'Authorization: Bearer <api_key>'.",
    };
  }
  return { ok: true, ownerId: caller.ownerId };
};
