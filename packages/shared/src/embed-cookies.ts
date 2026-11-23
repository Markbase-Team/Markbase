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
// EXPERIMENT. Only the embed proof turns this on (MARKBASE_EMBED_PROOF=1 on
// the server; being framed, in the browser). See docs/embed-proof.md.

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

/** The server's cookie options while the embed proof is on; nothing otherwise. */
export function serverEmbedCookieOptions(flag: string | undefined): EmbedCookieOptions | undefined {
  return flag === "1" ? EMBED_COOKIE_OPTIONS : undefined;
}
