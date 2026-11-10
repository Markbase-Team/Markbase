import type { Authorize } from "@markbase/protocol/caller";
import {
  buildConsentUrl,
  generateState,
  connectGmailAccount,
} from "../server/oauth";

// OAuth route-handler factories. Use plain Web Request/Response + Set-Cookie so
// the package doesn't depend on Next. The host injects its auth check.

const STATE_COOKIE = "g_oauth_state";

function appBase(req: Request): string {
  // Return the user to the SAME host they started on (localhost in dev, the
  // deployed domain in prod) — not a hardcoded APP_URL, which would bounce a
  // local OAuth flow to production.
  return new URL(req.url).origin;
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

// GET — redirect to Google's consent screen, stashing a CSRF state cookie.
export function oauthStartHandler(authorize: Authorize) {
  return async (req: Request): Promise<Response> => {
    const base = appBase(req);
    // A redirect, not a 401: this is a browser starting an OAuth flow, so an
    // unauthenticated caller is sent to sign in rather than handed JSON.
    if (!(await authorize(req, "write")).ok) {
      return Response.redirect(new URL("/admin/login", base), 302);
    }
    const state = generateState();
    let url: string;
    try {
      url = buildConsentUrl(state);
    } catch (e) {
      const message = e instanceof Error ? e.message : "OAuth not configured";
      return Response.json({ error: message }, { status: 500 });
    }
    const secure = process.env.NODE_ENV === "production";
    const cookie = `${STATE_COOKIE}=${state}; HttpOnly; Path=/; Max-Age=600; SameSite=Lax${
      secure ? "; Secure" : ""
    }`;
    return new Response(null, {
      status: 302,
      headers: { Location: url, "Set-Cookie": cookie },
    });
  };
}

// GET — Google redirects here; verify state, exchange code, store the account.
export function oauthCallbackHandler(authorize: Authorize) {
  return async (req: Request): Promise<Response> => {
    const base = appBase(req);
    const redirect = (path: string, setCookie?: string): Response =>
      new Response(null, {
        status: 302,
        headers: {
          Location: new URL(path, base).toString(),
          ...(setCookie ? { "Set-Cookie": setCookie } : {}),
        },
      });

    if (!(await authorize(req, "write")).ok) return redirect("/admin/login");

    const { searchParams } = new URL(req.url);
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    const cookieState = readCookie(req, STATE_COOKIE);
    if (!code || !state || !cookieState || state !== cookieState) {
      return redirect("/admin/inbox?error=oauth_state");
    }

    try {
      const email = await connectGmailAccount(code);
      const clear = `${STATE_COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`;
      return redirect(
        `/admin/inbox?connected=${encodeURIComponent(email)}`,
        clear
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : "connect_failed";
      return redirect(`/admin/inbox?error=${encodeURIComponent(message)}`);
    }
  };
}
