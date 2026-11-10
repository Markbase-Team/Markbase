// The authorize URL a device opens, and what the page at the other end reads
// from it — one definition for both sides.
//
// This is the step that kept breaking. The device (the CLI, the desktop app)
// built `/cli-auth?...` by hand in one package, and the page parsed the same
// parameters by hand in another; each side was right about its own half and
// nothing checked they agreed. The last time, the desktop stopped sending
// `desktop=1` for a reason of its own, and the page — reading that flag as
// "finish on your own" — went back to showing the CLI's Authorize button to a
// person who had just signed in and was waiting for the app. Both sides now
// go through here, and the test round-trips a request through the reader.

/** Where the browser step lives on the app. */
export const AUTHORIZE_PATH = "/cli-auth";

/** What a device asks for when it sends someone to the authorize page. */
export interface AuthorizeRequest {
  /** The device's loopback, `http://127.0.0.1:<port>` — where the key goes. */
  callback: string;
  /** The nonce the device generated; the key must come back with it. */
  state: string;
  /** Claude Code's version on the device, recorded on the minted key. */
  claudeVersion?: string | null;
  /**
   * A person signing into their own app — not a CLI being authorised. The page
   * then says "Sign in to Markbase" and finishes by itself, with no capability
   * to pick and no button to press.
   */
  desktop?: boolean;
  /** Mint the key inert, to be confirmed once it has arrived at the loopback. */
  confirm?: boolean;
}

/** The URL to open for `req`, on the app at `appUrl` (trailing slash or not). */
export function authorizeUrl(appUrl: string, req: AuthorizeRequest): string {
  const params = new URLSearchParams();
  params.set("callback", req.callback);
  params.set("state", req.state);
  if (req.claudeVersion) params.set("claude", req.claudeVersion);
  if (req.desktop) params.set("desktop", "1");
  if (req.confirm) params.set("confirm", "1");
  return `${appUrl.replace(/\/+$/, "")}${AUTHORIZE_PATH}?${params.toString()}`;
}

/** The query the page receives — Next hands it over as strings. */
export interface AuthorizeQuery {
  callback?: string;
  state?: string;
  capability?: string;
  claude?: string;
  desktop?: string;
  confirm?: string;
}

/** How the page should present itself for one request. */
export interface AuthorizeFraming {
  /** A person signing into their own app (see AuthorizeRequest.desktop). */
  desktop: boolean;
  /** Submit without asking: nothing to decide for a desktop sign-in. */
  autoFinish: boolean;
  /** The page's heading. */
  title: string;
  /** Mint the key inert (see AuthorizeRequest.confirm). */
  confirm: boolean;
  /** Claude Code's version as the device reported it, bounded; "" for none. */
  claudeVersion: string;
}

/**
 * Where the page sends a visitor who is not signed in: the app's /login, wired
 * to come back here with the SAME request once they are.
 *
 * Every parameter travels, not a hand-picked few. The last one left out was
 * `confirm`: a person who had to log in first came back and was minted a LIVE
 * key, parked in the browser's address bar, when the device had asked for an
 * inert one — exactly the case the confirm step exists for. Before that it was
 * `desktop`, and they got the CLI's Authorize button instead of a sign-in that
 * finishes by itself.
 */
export function signedOutRedirect(query: AuthorizeQuery): string {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(query)) {
    if (typeof value === "string" && value !== "") params.set(name, value);
  }
  return `/login?next=${encodeURIComponent(`${AUTHORIZE_PATH}?${params.toString()}`)}`;
}

/** What the authorize page reads out of its query. */
export function authorizeFraming(query: AuthorizeQuery): AuthorizeFraming {
  const desktop = query.desktop === "1";
  return {
    desktop,
    autoFinish: desktop,
    title: desktop ? "Sign in to Markbase" : "Connect the markbase CLI",
    confirm: query.confirm === "1",
    claudeVersion: query.claude?.trim().slice(0, 100) ?? "",
  };
}
