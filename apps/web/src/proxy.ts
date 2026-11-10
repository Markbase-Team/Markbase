import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import {
  forwardedCaller,
  offersToken,
  resolveCaller,
  type ReadSession,
} from "@markbase/node/caller";
import {
  CALLER_HEADER,
  CALLER_HEADER_PREFIX,
  serializeCaller,
} from "@markbase/protocol/auth";
import { updateSession } from "@/lib/supabase/middleware";
import { CORS_HEADERS } from "@/lib/agent-auth";
import {
  isDisabledRoute,
  parseDisabledRoutes,
} from "@markbase/registry/runtime";

// Next 16 renamed the "middleware" file convention to "proxy" (same behavior).
// The framework fixes both the filename and the exported name; this is still
// the middleware everything else means when it says "auth happens in one place".

// Features this build left out, as path prefixes. Inlined by next.config.ts —
// there are no manifests to read at request time. Parsed once at module scope
// because it cannot change without a redeploy.
const DISABLED_ROUTES = parseDisabledRoutes(
  process.env.MARKBASE_DISABLED_ROUTES_JSON
);

/**
 * What a guarded prefix asks of a caller.
 *
 * `required` — the gate means "prove who you are": a request nobody vouched
 * for is refused here, and the handlers behind the prefix take the caller
 * header for granted.
 *
 * `optional` — the gate means "if you offer a credential, I will establish
 * who you are": a credential that is offered is checked, and a bad one is
 * refused exactly as under `required`; but a request that offers nothing goes
 * through with no caller attached, and the feature decides what a stranger may
 * do. It exists for a feature with a third way in that the gate does not
 * know — `docs` admits anonymous guests on a share token, per document. The
 * header strip, the CORS answer and the cross-site rule apply in both modes.
 */
export type Identity = "required" | "optional";

/**
 * API prefixes this proxy authenticates, so the handlers behind them do not.
 *
 * One entry per feature that has moved; a prefix absent from this list behaves
 * exactly as it did before, which is what makes the migration one feature at a
 * time rather than one weekend. A handler behind a guarded prefix must never
 * resolve a caller itself — there is one gate, and this is it.
 *
 * THIS LIST IS THE WRONG WAY ROUND, on purpose and not forever. An allowlist of
 * protected paths means the default is unprotected: a new route that forgets to
 * authenticate ships open, and nothing says so. The end state is the inverse —
 * a PUBLIC list of the four routes that are deliberately reachable without
 * credentials, and everything else guarded — which cannot land until every
 * feature has moved, because until then it authenticates the others twice.
 *
 * The order they move in, what each one has to end up looking like, and the
 * preconditions for the flip: docs/auth-gate-migration.md.
 */
const GUARDED: ReadonlyArray<{ prefix: string; identity: Identity }> = [
  { prefix: "/api/v1/terms", identity: "required" },
  // docs admits anonymous guests on a share token, per document; the
  // handlers decide. Vaults and assets are served by the same package and
  // are account-level, so nobody anonymous has business there.
  { prefix: "/api/v1/docs", identity: "optional" },
  { prefix: "/api/v1/vaults", identity: "required" },
  { prefix: "/api/v1/assets", identity: "required" },
  // The unreleased features. Their route files left this app for their
  // packages (each manifest's `contributes.app`), and a package cannot read
  // the cookie session — so the gate reads it, and the handlers behind these
  // read the caller off the header it attaches. A build that leaves a feature
  // out 404s its prefix above before this list is consulted.
  { prefix: "/api/v1/attention", identity: "required" },
  { prefix: "/api/v1/inbox", identity: "required" },
  { prefix: "/api/v1/email", identity: "required" },
  { prefix: "/api/v1/reader", identity: "required" },
  { prefix: "/api/v1/learnings", identity: "required" },
  { prefix: "/api/admin/diaries", identity: "required" },
  { prefix: "/api/v1/agent-sessions", identity: "required" },
  // A skill's install script is public — it is a shell script that carries no
  // data and asks for the key itself. Everything else under the prefix
  // refuses a stranger in the handler.
  { prefix: "/api/v1/skills", identity: "optional" },
  { prefix: "/api/admin/skills", identity: "required" },
  { prefix: "/api/v1/todos", identity: "required" },
  { prefix: "/api/v1/tickets", identity: "required" },
  { prefix: "/api/v1/summary", identity: "required" },
  { prefix: "/api/v1/projects", identity: "required" },
  { prefix: "/api/v1/worker", identity: "required" },
  { prefix: "/api/v1/me/plan", identity: "required" },
  { prefix: "/api/admin/projects", identity: "required" },
  { prefix: "/api/admin/secrets", identity: "required" },
  // A worker's Claude Code session reports a ticket's commits and PR here,
  // with the worker's key. Outside /api, so the matcher names it.
  { prefix: "/progress", identity: "required" },
];

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function guardFor(pathname: string): Identity | null {
  const hit = GUARDED.find(
    ({ prefix }) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
  return hit ? hit.identity : null;
}

/**
 * Paths whose session cookie this proxy refreshes.
 *
 * Deliberately NOT the guarded API prefixes: refreshing rotates the cookie and
 * writes it back on the response, which is a thing to do for a person browsing
 * the app, not for an XHR the page fired. Reading the session (below) does not
 * rotate anything.
 */
function needsSession(pathname: string): boolean {
  return pathname === "/login" || pathname.startsWith("/dashboard");
}

/**
 * Channel 1, read off this request.
 *
 * Built from `request.cookies` rather than `next/headers` — `cookies()` wants a
 * request store this context has not entered. `setAll` is a no-op on purpose:
 * see `needsSession`.
 */
function sessionFromRequest(request: NextRequest): ReadSession {
  return async () => {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      {
        cookies: {
          getAll: () => request.cookies.getAll(),
          setAll: () => {},
        },
      }
    );
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user ? { id: user.id, email: user.email } : null;
  };
}

/**
 * Did this request come from somewhere that is not us?
 *
 * `Sec-Fetch-Site` is set by the browser and cannot be spoofed by script;
 * `none` is a typed URL or a bookmark. Older clients don't send it, so fall
 * back to comparing `Origin`, which browsers attach to every cross-site write.
 * A request with neither is not a browser, and a non-browser had to set its own
 * headers — which is the thing CSRF cannot do.
 */
function crossSite(request: NextRequest): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site) return site !== "same-origin" && site !== "none";
  const origin = request.headers.get("origin");
  return origin !== null && origin !== request.nextUrl.origin;
}

function withCors(response: NextResponse): NextResponse {
  for (const [k, v] of Object.entries(CORS_HEADERS)) response.headers.set(k, v);
  return response;
}

/**
 * The request headers a handler will see: the caller's, minus the namespace
 * this gate owns. Stripped before anything is set — this namespace has exactly
 * one writer, and without this step anyone who sends `x-markbase-caller` is
 * anyone. Stripped on an anonymous pass-through too, for the same reason.
 */
function stripped(request: NextRequest): Headers {
  const headers = new Headers(request.headers);
  for (const name of [...headers.keys()]) {
    if (name.startsWith(CALLER_HEADER_PREFIX)) headers.delete(name);
  }
  return headers;
}

/**
 * The gate: two channels in, one identity out.
 *
 * Either credential passing attaches the resolved caller to the request, and
 * the handler behind it reads that and never learns which channel was used.
 *
 * Exported for its tests: `proxy` decides which prefix gets which mode, and
 * this decides what a mode means, and the second is worth proving on its own
 * before a prefix uses it.
 */
export async function guard(
  request: NextRequest,
  identity: Identity
): Promise<NextResponse> {
  if (request.method === "OPTIONS") {
    return withCors(new NextResponse(null, { status: 204 }));
  }

  const write = !SAFE_METHODS.has(request.method);
  const caller = await resolveCaller(
    request,
    write ? "write" : "read",
    sessionFromRequest(request)
  );
  const headers = stripped(request);

  if (!caller.ok) {
    // A refusal is a refusal — unless the prefix admits strangers and this
    // request offered nothing to refuse. A cookie that resolved to nobody is
    // nothing: an expired session must not lock a guest out of a share link.
    // A bearer token that failed is not nothing, whatever the mode: a bad key
    // never falls through to anonymous, here or in `resolveCaller`.
    if (identity === "optional" && !offersToken(request)) {
      return withCors(NextResponse.next({ request: { headers } }));
    }
    return withCors(
      NextResponse.json({ error: caller.error }, { status: caller.status })
    );
  }

  // A cookie is attached by the browser whether the page meant it or not, so a
  // write that came from another site is refused. The bearer channel needs no
  // such check: nobody else can put an Authorization header on your request.
  if (caller.via === "session" && write && crossSite(request)) {
    return withCors(
      NextResponse.json({ error: "Cross-site write refused." }, { status: 403 })
    );
  }

  headers.set(CALLER_HEADER, serializeCaller(forwardedCaller(caller)));
  return withCors(NextResponse.next({ request: { headers } }));
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // A feature left out of this build does not exist, so its routes are Not
  // Found rather than Forbidden: 403 would tell a stranger the feature is real
  // and they simply lack access.
  if (isDisabledRoute(DISABLED_ROUTES, pathname)) {
    return new NextResponse(null, { status: 404 });
  }

  const identity = guardFor(pathname);
  if (identity) return guard(request, identity);
  if (needsSession(pathname)) return updateSession(request);
  return NextResponse.next();
}

// Gate the app pages, bounce signed-in users off /login, authenticate the
// guarded API prefixes, and give the feature guard a chance to 404 a disabled
// feature's routes. API routes outside GUARDED still authenticate themselves.
export const config = {
  matcher: ["/dashboard/:path*", "/login", "/api/:path*", "/progress"],
};
