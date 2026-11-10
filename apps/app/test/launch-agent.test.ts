import { describe, it, expect } from "vitest";
import {
  AT_LOGIN_FLAG,
  LAUNCH_AGENT_LABEL,
  installLaunchAgent,
  launchAgentInstalled,
  launchAgentPath,
  launchAgentPlist,
  uninstallLaunchAgent,
  type LaunchAgentFs,
} from "../src/launch-agent";

// The agent is what makes the worker outlive a reboot and a crash. These pin
// the two plist keys that do that, the wrapper that keeps a deleted app from
// relaunching forever, and the install/remove decisions — all on a fake disk.

const spec = {
  execPath: "/Applications/Markbase.app/Contents/MacOS/Markbase",
  logPath: "/Users/me/Library/Application Support/Markbase/launchd.log",
};

function fakeFs(): LaunchAgentFs & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    exists: (path) => files.has(path),
    read: (path) => {
      const contents = files.get(path);
      if (contents === undefined) throw new Error(`ENOENT ${path}`);
      return contents;
    },
    write: (path, contents) => void files.set(path, contents),
    remove: (path) => void files.delete(path),
  };
}

describe("launchAgentPlist", () => {
  const plist = launchAgentPlist(spec);

  it("opens the app at login, in the menu bar only", () => {
    expect(plist).toContain("<key>RunAtLoad</key><true/>");
    expect(plist).toContain(`exec "$0" ${AT_LOGIN_FLAG}`);
    expect(plist).toContain(`<string>${spec.execPath}</string>`);
  });

  it("relaunches after a crash but not after a Quit", () => {
    expect(plist).toMatch(/<key>KeepAlive<\/key>\s*<dict>\s*<key>SuccessfulExit<\/key><false\/>\s*<\/dict>/);
  });

  it("exits cleanly, so launchd stops retrying, once the app is gone", () => {
    expect(plist).toContain('test -x "$0" || exit 0');
  });

  it("is labelled with the app's bundle id and keeps the app's last words", () => {
    expect(plist).toContain(`<key>Label</key><string>${LAUNCH_AGENT_LABEL}</string>`);
    expect(plist).toContain(`<key>StandardErrorPath</key><string>${spec.logPath}</string>`);
  });

  it("escapes a path that would break the XML", () => {
    const odd = launchAgentPlist({ ...spec, execPath: "/Apps/<Mark & Base>/Markbase" });
    expect(odd).toContain("/Apps/&lt;Mark &amp; Base&gt;/Markbase");
    expect(odd).not.toContain("<Mark");
  });

  it("only runs in a GUI login session", () => {
    expect(plist).toContain("<key>LimitLoadToSessionType</key><string>Aqua</string>");
  });
});

describe("launchAgentPath", () => {
  it("is the per-user LaunchAgents plist named after the label", () => {
    expect(launchAgentPath("/Users/me")).toBe(`/Users/me/Library/LaunchAgents/${LAUNCH_AGENT_LABEL}.plist`);
  });
});

describe("installLaunchAgent", () => {
  const path = launchAgentPath("/Users/me");

  it("writes the plist the first time", () => {
    const fs = fakeFs();
    expect(installLaunchAgent(spec, path, fs)).toBe("installed");
    expect(fs.files.get(path)).toBe(launchAgentPlist(spec));
    expect(launchAgentInstalled(path, fs)).toBe(true);
  });

  it("leaves an up-to-date plist alone", () => {
    const fs = fakeFs();
    installLaunchAgent(spec, path, fs);
    expect(installLaunchAgent(spec, path, fs)).toBe("unchanged");
  });

  it("rewrites the plist when the app has moved", () => {
    const fs = fakeFs();
    installLaunchAgent(spec, path, fs);
    const moved = { ...spec, execPath: "/Volumes/Apps/Markbase.app/Contents/MacOS/Markbase" };
    expect(installLaunchAgent(moved, path, fs)).toBe("updated");
    expect(fs.files.get(path)).toContain(moved.execPath);
    expect(fs.files.get(path)).not.toContain(spec.execPath);
  });
});

describe("uninstallLaunchAgent", () => {
  const path = launchAgentPath("/Users/me");

  it("removes an installed plist and reports it", () => {
    const fs = fakeFs();
    installLaunchAgent(spec, path, fs);
    expect(uninstallLaunchAgent(path, fs)).toBe(true);
    expect(launchAgentInstalled(path, fs)).toBe(false);
  });

  it("is a no-op without one", () => {
    expect(uninstallLaunchAgent(path, fakeFs())).toBe(false);
  });
});
