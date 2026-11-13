// Being the Mac's default app for markdown files.
//
// The app registers as a handler for .md (fileAssociations in package.json),
// which only puts it in Finder's "Open With" list. Which app a double click
// opens is a LaunchServices setting, and Electron has no API for it — only for
// URL schemes. So this asks LaunchServices directly, through `osascript -l
// JavaScript`: it ships with every Mac, where a compiled helper would be one
// more binary to sign.
//
// The offer is made once, in the main window after the first sign-in (see
// DefaultOpenerOffer in renderer/dashboard), and only where it means
// something: a packaged app on a Mac that is not the default already.
//
// Nothing here imports electron, so the decision is unit-tested.

import { execFile } from "node:child_process";
import { LAUNCH_AGENT_LABEL } from "./launch-agent";

/** The app's bundle id (`build.appId` in package.json). */
export const APP_BUNDLE_ID = LAUNCH_AGENT_LABEL;

/** The content type macOS gives .md, .markdown and their relatives. */
export const MARKDOWN_CONTENT_TYPE = "net.daringfireball.markdown";

const READ_SCRIPT = `function run(argv) {
  ObjC.import('CoreServices');
  const ref = $.LSCopyDefaultRoleHandlerForContentType($(argv[0]), $.kLSRolesAll);
  return ObjC.unwrap(ObjC.castRefToObject(ref)) || '';
}`;

const SET_SCRIPT = `function run(argv) {
  ObjC.import('CoreServices');
  return String($.LSSetDefaultRoleHandlerForContentType($(argv[0]), $.kLSRolesAll, $(argv[1])));
}`;

/** Run a JXA script and answer what it printed, or null when it could not run. */
export type RunScript = (script: string, args: string[]) => Promise<string | null>;

const osascript: RunScript = (script, args) =>
  new Promise((resolve) => {
    execFile(
      "/usr/bin/osascript",
      ["-l", "JavaScript", "-e", script, ...args],
      { timeout: 10_000 },
      (error, stdout) => resolve(error ? null : stdout.trim())
    );
  });

/** The bundle id of the app a double-clicked .md opens in; null when unknown. */
export async function defaultMarkdownOpener(run: RunScript = osascript): Promise<string | null> {
  const id = await run(READ_SCRIPT, [MARKDOWN_CONTENT_TYPE]);
  return id ? id : null;
}

/** Make this app the one a double-clicked .md opens in. True when macOS took it. */
export async function becomeDefaultMarkdownOpener(run: RunScript = osascript): Promise<boolean> {
  // LaunchServices answers an OSStatus; 0 is noErr.
  const status = await run(SET_SCRIPT, [MARKDOWN_CONTENT_TYPE, APP_BUNDLE_ID]);
  if (status !== "0") return false;
  const now = await defaultMarkdownOpener(run);
  return now?.toLowerCase() === APP_BUNDLE_ID.toLowerCase();
}

export interface OfferFacts {
  platform: NodeJS.Platform;
  /** A dev build runs as Electron.app, whose bundle id is not this app's. */
  packaged: boolean;
  signedIn: boolean;
  /** The offer was made before on this machine, whatever the answer was. */
  offeredBefore: boolean;
  /** What opens .md now; null when it could not be read. */
  currentOpener: string | null;
}

/** Should the main window offer to make this app the default for markdown? */
export function shouldOfferDefaultOpener(facts: OfferFacts): boolean {
  if (facts.platform !== "darwin" || !facts.packaged) return false;
  if (!facts.signedIn || facts.offeredBefore) return false;
  return facts.currentOpener?.toLowerCase() !== APP_BUNDLE_ID.toLowerCase();
}
