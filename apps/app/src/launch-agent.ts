// The app's own launch agent: how the worker survives reboots and crashes.
//
// A person who installed the DMG gets tickets run and vaults synced for as long
// as the app is running — and nothing more. Before this file, "as long as" ended
// at the next reboot (nothing opened the app again) and at the next main-process
// crash (nothing relaunched it). The CLI's launchd service had both covered with
// two plist keys; the app, which replaced that service on a Mac (see the CLI's
// desktop-app.ts), had neither.
//
// So the app registers a launchd agent for ITSELF. RunAtLoad opens it at login,
// in the menu bar with no window (AT_LOGIN_FLAG). KeepAlive on an unsuccessful
// exit relaunches it after a crash or a Force Quit — and leaves it alone after
// a Quit from the tray, which exits 0, so quitting still means quit.
//
// Not Electron's setLoginItemSettings: on macOS 13+ that is SMAppService, which
// opens the app at login but never relaunches it, and which a stable code
// signature is needed for — this app is ad-hoc signed (see storeApiKey in
// main.ts). A plist in ~/Library/LaunchAgents needs neither, and macOS still
// lists it under Login Items › Allow in the Background, where it can be turned
// off; the tray has a switch for the same thing.
//
// The agent takes effect at the NEXT login: writing the plist is enough for
// launchd to pick it up then, and loading it now would start a second copy of
// the app next to the one that is installing it. Until then this instance is
// the unsupervised one it always was.
//
// Nothing here imports electron, so the plist and the decisions are unit-tested
// with a fake filesystem.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** The app's bundle id (`build.appId` in package.json), doubling as the job label. */
export const LAUNCH_AGENT_LABEL = "com.markbase-jia.ticketing";

/** How the agent launches the app: menu bar only, no window. */
export const AT_LOGIN_FLAG = "--at-login";

export function launchAgentPath(home: string = homedir()): string {
  return join(home, "Library", "LaunchAgents", `${LAUNCH_AGENT_LABEL}.plist`);
}

export interface LaunchAgentSpec {
  /** The app's executable — process.execPath of the packaged app. */
  execPath: string;
  /** Where launchd sends the app's stdout and stderr: the last words of a crash. */
  logPath: string;
}

function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * The plist. The program is a one-line shell wrapper rather than the app itself
 * so that an app dragged to the Trash exits 0 at the next login — a missing
 * program would otherwise be an unsuccessful exit, which KeepAlive retries
 * every ten seconds, forever, for an app that is no longer there.
 */
export function launchAgentPlist(spec: LaunchAgentSpec): string {
  const script = `test -x "$0" || exit 0; exec "$0" ${AT_LOGIN_FLAG}`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LAUNCH_AGENT_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/sh</string>
    <string>-c</string>
    <string>${xmlEscape(script)}</string>
    <string>${xmlEscape(spec.execPath)}</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key><false/>
  </dict>
  <key>ProcessType</key><string>Interactive</string>
  <key>LimitLoadToSessionType</key><string>Aqua</string>
  <key>StandardOutPath</key><string>${xmlEscape(spec.logPath)}</string>
  <key>StandardErrorPath</key><string>${xmlEscape(spec.logPath)}</string>
</dict>
</plist>
`;
}

/** The filesystem, as this module needs it — swapped for a fake in tests. */
export interface LaunchAgentFs {
  exists: (path: string) => boolean;
  read: (path: string) => string;
  write: (path: string, contents: string) => void;
  remove: (path: string) => void;
}

export const diskFs: LaunchAgentFs = {
  exists: existsSync,
  read: (path) => readFileSync(path, "utf8"),
  write: (path, contents) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents);
  },
  remove: (path) => rmSync(path, { force: true }),
};

export function launchAgentInstalled(path: string, fs: LaunchAgentFs = diskFs): boolean {
  return fs.exists(path);
}

export type InstallResult = "installed" | "updated" | "unchanged";

/**
 * Put the agent in place, or bring it up to date. Idempotent and cheap, so the
 * app calls it on every launch: an app that moved, or a newer plist shape,
 * gets rewritten; an agent that already says this stays untouched.
 */
export function installLaunchAgent(
  spec: LaunchAgentSpec,
  path: string,
  fs: LaunchAgentFs = diskFs
): InstallResult {
  const wanted = launchAgentPlist(spec);
  const had = fs.exists(path);
  if (had && fs.read(path) === wanted) return "unchanged";
  fs.write(path, wanted);
  return had ? "updated" : "installed";
}

/**
 * Remove the agent, so the next login starts nothing. The job stays loaded for
 * the rest of THIS session on purpose: unloading it would have launchd stop
 * the app that is running under it — the one the person is using right now.
 */
export function uninstallLaunchAgent(path: string, fs: LaunchAgentFs = diskFs): boolean {
  if (!fs.exists(path)) return false;
  fs.remove(path);
  return true;
}
