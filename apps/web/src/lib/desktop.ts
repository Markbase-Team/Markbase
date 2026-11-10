import { headers } from "next/headers";

/**
 * Is this request from the desktop app's own window?
 *
 * The app loads the instance's sign-in and sign-up pages in its window, and a
 * few things only make sense there — the instance switcher, say, which moves
 * the APP, not the browser. Electron's user agent names itself, so that is
 * the tell; a browser never carries it.
 */
export async function inDesktopApp(): Promise<boolean> {
  const ua = (await headers()).get("user-agent") ?? "";
  return /\bElectron\//.test(ua);
}
