import { describe, it, expect, vi } from "vitest";
import {
  DESKTOP_APP_BUNDLE_ID,
  DESKTOP_APP_PATH,
  desktopAppInstalled,
  type DesktopAppProbe,
} from "../src/desktop-app";

// Detection decides whether `login`/`init` set up a launchd service at all, so
// a false positive leaves a Mac with no worker and a false negative leaves it
// with two. Every probe here is injected: nothing touches the real disk.

function probe(overrides: Partial<DesktopAppProbe>): DesktopAppProbe {
  return {
    platform: "darwin",
    exists: () => false,
    mdfind: async () => "",
    ...overrides,
  };
}

describe("desktopAppInstalled", () => {
  it("is true when the app sits in /Applications, without asking Spotlight", async () => {
    const mdfind = vi.fn(async () => "");
    const exists = (path: string) => path === DESKTOP_APP_PATH;
    expect(await desktopAppInstalled(probe({ exists, mdfind }))).toBe(true);
    expect(mdfind).not.toHaveBeenCalled();
  });

  it("is true when Spotlight lists the bundle somewhere else that exists", async () => {
    const home = "/Users/me/Applications/Markbase.app";
    const mdfind = vi.fn(async () => `${home}\n`);
    const exists = (path: string) => path === home;
    expect(await desktopAppInstalled(probe({ exists, mdfind }))).toBe(true);
    expect(mdfind).toHaveBeenCalledWith(DESKTOP_APP_BUNDLE_ID);
  });

  it("is false when nothing is on disk and Spotlight has nothing", async () => {
    expect(await desktopAppInstalled(probe({}))).toBe(false);
  });

  it("ignores a copy that only lives in the Trash", async () => {
    const trashed = "/Users/me/.Trash/Markbase.app";
    const exists = (path: string) => path === trashed;
    expect(await desktopAppInstalled(probe({ exists, mdfind: async () => trashed }))).toBe(false);
  });

  it("ignores a path Spotlight still lists but that is gone", async () => {
    const stale = "/Volumes/Old/Markbase.app";
    expect(await desktopAppInstalled(probe({ mdfind: async () => stale }))).toBe(false);
  });

  it("treats a failing mdfind as 'not found' rather than crashing setup", async () => {
    const mdfind = async () => {
      throw new Error("spawn mdfind ENOENT");
    };
    expect(await desktopAppInstalled(probe({ mdfind }))).toBe(false);
  });

  it("is false off macOS even if a same-named path exists", async () => {
    const mdfind = vi.fn(async () => DESKTOP_APP_PATH);
    expect(await desktopAppInstalled(probe({ platform: "linux", exists: () => true, mdfind }))).toBe(false);
    expect(mdfind).not.toHaveBeenCalled();
  });
});
