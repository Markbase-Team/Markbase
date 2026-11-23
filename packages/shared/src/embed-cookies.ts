// Session cookies for Markbase shown inside another site's page — an AI app's
// card, framed full page.
//
// A browser treats a framed page's cookies as third-party. The session's
// default cookies (SameSite=Lax) are then not sent at all, and a browser that
// blocks third-party cookies drops them on the floor. What survives is a
// cookie that says it is meant for that (SameSite=None; Secure) and keeps to
// one top-level site (Partitioned, "CHIPS"): a session in that frame, under
// that site, which no other site can see and which never touches the
// person's own markbase.so session.
//
// EXPERIMENT (docs/embed-proof.md). The browser uses these whenever it is in
// another site's frame. The server uses them for a request that carries the
// embed marker, which /embed sets — partitioned, so only that frame ever
// sends it — and for every request with MARKBASE_EMBED_PROOF=1 (local proof
// only). The person's own markbase.so session is never touched.

export interface EmbedCookieOptions {
  sameSite: "none";
  secure: true;
  partitioned: true;
}

export const EMBED_COOKIE_OPTIONS: EmbedCookieOptions = { sameSite: "none", secure: true, partitioned: true };

/** As much of a browser window as framing is judged by (this package has no DOM types). */
interface FrameWindow {
  self: FrameWindow;
  top: FrameWindow | null;
}

/** Is this page in someone else's frame? False outside a browser. */
export function inForeignFrame(): boolean {
  const win = (globalThis as { window?: FrameWindow }).window;
  if (!win) return false;
  try {
    return win.self !== win.top;
  } catch {
    // Reading window.top across origins can throw: that is a foreign frame.
    return true;
  }
}

/**
 * Set by /embed beside the session, partitioned like it: a request that
 * carries it comes from a frame Markbase was signed into through a hand-off,
 * so the session cookies the server writes back must be embed cookies too.
 */
export const EMBED_MARKER_COOKIE = "mb-embed";

/** As much of a cookie jar as the marker is looked up in. */
export interface CookieReader {
  get(name: string): { value: string } | undefined;
}

/** The server's cookie options for this request: embed cookies inside an embed, the defaults otherwise. */
export function serverEmbedCookieOptions(
  flag: string | undefined,
  cookies?: CookieReader
): EmbedCookieOptions | undefined {
  if (flag === "1") return EMBED_COOKIE_OPTIONS;
  return cookies?.get(EMBED_MARKER_COOKIE) ? EMBED_COOKIE_OPTIONS : undefined;
}
