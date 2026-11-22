import { verifyApiKey, type ApiKey, type ApiScope } from "./api-keys";
import { providerFromClient, setConnectionProvider } from "@markbase/protocol";
import type { Caller as ForwardedCaller } from "@markbase/protocol/auth";

/**
 * Who is making this request — resolved the same way for every route.
 *
 * There is one API, not an "app API" and an "agent API". A route should not
 * care whether the caller arrived with a browser session or a bearer token; it
 * cares who they are and what they may do. This resolves both to the same
 * answer, so the handler above it can be written once and served by any shell.
 *
 * The session half is INJECTED rather than imported. Reading a cookie session
 * needs `next/headers`, which only the Next shell has — and a package that
 * imports it can only ever run inside Next. So the shell supplies "is there a
 * signed-in user", this supplies everything else, and the seam falls exactly
 * where the two shells actually differ.
 */

export type { ApiScope };

/** The signed-in user, as the shell sees it. Null when nobody is signed in. */
export type SessionUser = { id: string; email?: string | null };

/** How the shell reads its own session. The web shell passes a cookie reader. */
export type ReadSession = () => Promise<SessionUser | null>;

export type Caller =
  // `email` rides along with the session so callers need not ask a second time:
  // resolving it is a network call to Supabase's auth endpoint, and re-asking
  // cost every request an extra sequential round trip for a value already held.
  | { ok: true; via: "session"; ownerId: string; email: string | null }
  | { ok: true; via: "api_key"; key: ApiKey; ownerId: string }
  | { ok: false; status: number; error: string };

/** A bearer token or X-Api-Key header, whichever the caller sent. */
function extractToken(req: Request): string {
  const auth = req.headers.get("authorization") ?? "";
  if (/^bearer\s+/i.test(auth)) return auth.replace(/^bearer\s+/i, "").trim();
  return (req.headers.get("x-api-key") ?? "").trim();
}

/** A caller `resolveCaller` accepted. */
export type Accepted = Extract<Caller, { ok: true }>;

/**
 * What the gate tells the feature about a caller it accepted — the projection
 * that goes on the caller header.
 *
 * A key is reduced to the three facts a feature attributes with: the row id
 * (to claim an agent session under), the provider (to name the agent) and the
 * ceiling (to cap it). Not the name, not the prefix, not the scopes — the
 * scope was enforced before this was built.
 */
export function forwardedCaller(caller: Accepted): ForwardedCaller {
  if (caller.via === "session") {
    return { via: "session", ownerId: caller.ownerId, email: caller.email };
  }
  return {
    via: "api_key",
    ownerId: caller.ownerId,
    key: {
      id: caller.key.id,
      provider: caller.key.provider,
      capability: caller.key.capability,
    },
  };
}

/**
 * Did this request offer a bearer credential at all?
 *
 * The gate asks this when `resolveCaller` refused, to tell two refusals apart
 * that carry the same status: a request that offered nothing, which a prefix
 * admitting strangers may still let through, and a request that offered a key
 * and was wrong about it, which nobody lets through. The header names live
 * here with the one function that reads them, so the gate never spells them.
 */
export function offersToken(req: Request): boolean {
  return extractToken(req) !== "";
}

/**
 * Resolve the caller, or the refusal to return.
 *
 * THE KEY FIRST, THEN THE SESSION. A request that carries a token is stating
 * its intent, and in this codebase that matters more than tidiness: the key
 * carries a capability ceiling the session does not. `/cli-auth/approve` calls
 * that ceiling "the security boundary — anything an agent on this machine does
 * is capped here, and no header/session trick can widen it". Resolving a keyed
 * request as its cookie session IS such a trick: a machine deliberately capped
 * at `commenter` would come back as the owner.
 *
 * That is not hypothetical. The desktop window is a browser signed in to the
 * site, and the local pages it will serve hold an API key too — both credentials
 * on one request is the ordinary case there, not the strange one.
 *
 * Reordering costs nothing. The key branch is gated on the Authorization header
 * being present, so a cookie-only request from the app never reaches a key
 * lookup — which is all the old "never pay for a key lookup" ordering bought.
 *
 * Either way the answer carries `ownerId` — whose data this request may reach —
 * so a handler scopes by that one field and never learns which path was taken.
 */
export async function resolveCaller(
  req: Request,
  need: ApiScope,
  readSession: ReadSession
): Promise<Caller> {
  // Channel 2 — the bearer token, for everything without a cookie jar.
  //
  // A bad token is a refusal, never a fallthrough to the session. Falling
  // through is how a capped key silently becomes an owner, and it would also
  // make a typo'd key look like it worked.
  const token = extractToken(req);
  if (token) {
    const key = await verifyApiKey(token);
    if (!key) return { ok: false, status: 401, error: "Invalid API key." };
    if (!key.owner_id) {
      return { ok: false, status: 403, error: "This API key has no owner." };
    }
    if (!key.scopes.includes(need)) {
      return {
        ok: false,
        status: 403,
        error: `This API key lacks the '${need}' scope.`,
      };
    }
    // Capture which client this connection is (Claude Code, Cursor, Codex…) the
    // first time we can identify it. The MCP server forwards its clientInfo name
    // as X-MCP-Client; only stamps when still 'unknown', so it never overwrites a
    // real signal. Best-effort — never blocks the request.
    const client = req.headers.get("x-mcp-client");
    if (client && key.provider === "unknown") {
      void setConnectionProvider(key.id, providerFromClient(client)).catch(() => {});
    }
    return { ok: true, via: "api_key", key, ownerId: key.owner_id };
  }

  // Channel 1 — the browser's cookie, attached for us by the browser.
  const user = await readSession();
  if (user) {
    return { ok: true, via: "session", ownerId: user.id, email: user.email ?? null };
  }

  return {
    ok: false,
    status: 401,
    error:
      "Missing credentials. Sign in, or send 'Authorization: Bearer <api_key>'.",
  };
}
