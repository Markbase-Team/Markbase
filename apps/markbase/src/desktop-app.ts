import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";

const exec = promisify(execFile);

/** The desktop app's bundle id — `build.appId` in apps/app/package.json. */
export const DESKTOP_APP_BUNDLE_ID = "com.markbase-jia.ticketing";
export const DESKTOP_APP_PATH = "/Applications/Markbase.app";

/**
 * The one line every command prints when it would otherwise set up a service
 * next to the app. On a Mac with the app, the app is the background process:
 * it lives in the menu bar and runs tickets with its bundled Claude.
 */
export const DESKTOP_APP_NOTE =
  "The Markbase desktop app is installed on this Mac and runs your tickets from the menu bar, so the background service isn't needed.";

export type DesktopAppProbe = {
  platform: NodeJS.Platform;
  exists: (path: string) => boolean;
  /** Paths Spotlight lists for a bundle id, one per line — "" when it has none. */
  mdfind: (bundleId: string) => Promise<string>;
};

/**
 * Is the Markbase desktop app installed on this machine? True when
 * /Applications/Markbase.app exists, or when Spotlight knows a bundle with the
 * app's id somewhere else (~/Applications, say). A copy in the Trash doesn't
 * count, and neither does a path the index still lists but that is gone.
 */
export async function desktopAppInstalled(probe: DesktopAppProbe): Promise<boolean> {
  if (probe.platform !== "darwin") return false;
  if (probe.exists(DESKTOP_APP_PATH)) return true;
  const listed = await probe.mdfind(DESKTOP_APP_BUNDLE_ID).catch(() => "");
  return listed
    .split("\n")
    .map((line) => line.trim())
    .filter((path) => path.length > 0 && !path.includes("/.Trash/"))
    .some((path) => probe.exists(path));
}

async function mdfindBundle(bundleId: string): Promise<string> {
  const { stdout } = await exec("mdfind", [`kMDItemCFBundleIdentifier == "${bundleId}"`]);
  return stdout;
}

/** The live probe: this machine's filesystem and Spotlight index. */
export function detectDesktopApp(): Promise<boolean> {
  return desktopAppInstalled({ platform: process.platform, exists: existsSync, mdfind: mdfindBundle });
}
