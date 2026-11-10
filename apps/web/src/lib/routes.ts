// Where a signed-in person lands when they haven't asked for anywhere in
// particular — after logging in, after signing up, after an OAuth bounce, and
// when the desktop app opens its window.
//
// It is one destination, so it is one constant. Spelled out at each of those
// call sites it drifted: login and signup sent people to their documents while
// the OAuth callback and the desktop app still opened the ticket board, so where
// you ended up depended on which door you came through.
//
// The desktop app keeps its own copy (apps/app/src/main.ts) — it loads this URL
// against APP_URL from a separate bundle and can't import from the web app.
export const SIGNED_IN_HOME = "/dashboard/documents";

/**
 * A caller-supplied `next`, or the default. Only same-site paths are honoured:
 * an absolute URL here would be an open redirect, handing anyone a link that
 * carries our sign-in flow to their own site.
 */
export function safeNext(next: string | null | undefined): string {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : SIGNED_IN_HOME;
}
