import { describe, it, expect } from "vitest";
import {
  APP_BUNDLE_ID,
  MARKDOWN_CONTENT_TYPE,
  becomeDefaultMarkdownOpener,
  defaultMarkdownOpener,
  shouldOfferDefaultOpener,
  type OfferFacts,
  type RunScript,
} from "../src/default-opener";

// The offer to open markdown files with Markbase is made once, and only where
// saying yes would change something. These pin that decision, and what counts
// as macOS having taken the change — with a fake in place of osascript.

const firstSignIn: OfferFacts = {
  platform: "darwin",
  packaged: true,
  signedIn: true,
  offeredBefore: false,
  currentOpener: "com.apple.TextEdit",
};

describe("shouldOfferDefaultOpener", () => {
  it("offers after a first sign-in when another app opens markdown", () => {
    expect(shouldOfferDefaultOpener(firstSignIn)).toBe(true);
  });

  it("offers when the current opener could not be read", () => {
    expect(shouldOfferDefaultOpener({ ...firstSignIn, currentOpener: null })).toBe(true);
  });

  it("does not offer twice", () => {
    expect(shouldOfferDefaultOpener({ ...firstSignIn, offeredBefore: true })).toBe(false);
  });

  it("does not offer what is already so, whatever the id's case", () => {
    expect(
      shouldOfferDefaultOpener({ ...firstSignIn, currentOpener: APP_BUNDLE_ID.toUpperCase() })
    ).toBe(false);
  });

  it("does not offer before sign-in, off the Mac, or in a dev build", () => {
    expect(shouldOfferDefaultOpener({ ...firstSignIn, signedIn: false })).toBe(false);
    expect(shouldOfferDefaultOpener({ ...firstSignIn, platform: "win32" })).toBe(false);
    expect(shouldOfferDefaultOpener({ ...firstSignIn, packaged: false })).toBe(false);
  });
});

/** A LaunchServices that remembers one handler, and can refuse to change it. */
function fakeLaunchServices(initial: string, status = "0"): RunScript & { calls: string[][] } {
  let handler = initial;
  const calls: string[][] = [];
  const run = async (_script: string, args: string[]): Promise<string | null> => {
    calls.push(args);
    if (args.length === 1) return handler;
    if (status === "0") handler = args[1];
    return status;
  };
  return Object.assign(run, { calls });
}

describe("the default markdown opener", () => {
  it("reads the handler of the markdown content type", async () => {
    const run = fakeLaunchServices("com.apple.TextEdit");
    expect(await defaultMarkdownOpener(run)).toBe("com.apple.TextEdit");
    expect(run.calls).toEqual([[MARKDOWN_CONTENT_TYPE]]);
  });

  it("answers null when nothing could be read", async () => {
    expect(await defaultMarkdownOpener(async () => null)).toBeNull();
    expect(await defaultMarkdownOpener(async () => "")).toBeNull();
  });

  it("becomes the default and confirms it by reading back", async () => {
    const run = fakeLaunchServices("com.apple.TextEdit");
    expect(await becomeDefaultMarkdownOpener(run)).toBe(true);
    expect(run.calls[0]).toEqual([MARKDOWN_CONTENT_TYPE, APP_BUNDLE_ID]);
    expect(await defaultMarkdownOpener(run)).toBe(APP_BUNDLE_ID);
  });

  it("says no when macOS refuses", async () => {
    const run = fakeLaunchServices("com.apple.TextEdit", "-54");
    expect(await becomeDefaultMarkdownOpener(run)).toBe(false);
  });
});
