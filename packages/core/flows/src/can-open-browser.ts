// Can this machine put a browser in front of a person?
//
// Signing in waits on a loopback redirect. At a desk that works: the browser
// opens, the person authorizes, the redirect comes back to localhost. Over SSH
// none of it does — `open`/`xdg-open` fails silently, and the printed fallback
// URL is worse than useless, because opening it on YOUR computer redirects to a
// localhost on THAT computer, where nothing is listening. The sign-in then waits
// for a 30-minute backstop nobody knew about.
//
// This is a heuristic, and both kinds of mistake cost something: a wrong "no"
// strands someone at a desktop, a wrong "yes" hangs a server. Hence the
// override, for the cases a machine cannot work out for itself.

export interface BrowserEnvironment {
  platform: NodeJS.Platform | string;
  env: Record<string, string | undefined>;
}

export function canOpenBrowser(
  where: BrowserEnvironment = { platform: process.platform, env: process.env }
): boolean {
  const { platform, env } = where;

  // Someone who knows better than this function: a forwarded display, a
  // container with a tunnel, a headless box that really does have a browser.
  const override = env.MARKBASE_BROWSER;
  if (override === "1" || override === "true") return true;
  if (override === "0" || override === "false") return false;

  const hasDisplay = Boolean(env.DISPLAY || env.WAYLAND_DISPLAY);

  // SSH means the person is somewhere else — unless they forwarded a display,
  // which is exactly the case where opening a browser does still work.
  if (env.SSH_CONNECTION || env.SSH_TTY || env.SSH_CLIENT) return hasDisplay;

  // A Linux box with no display server has nothing to open a browser onto.
  if (platform === "linux") return hasDisplay;

  // macOS and Windows: a local session has a browser.
  return true;
}
