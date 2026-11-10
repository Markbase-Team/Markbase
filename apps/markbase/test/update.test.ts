import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";

// `markbase update` restarts an installed service by spawning `install-service`
// from the new version. Next to the desktop app that restart is the same
// redundant install `login`/`init` now skip — so update must skip it too.

const spawned: string[][] = [];
vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  spawn: (cmd: string, args: string[]) => {
    spawned.push([cmd, ...args]);
    const child = new EventEmitter();
    queueMicrotask(() => child.emit("close", 0));
    return child;
  },
}));
vi.mock("@markbase/protocol", () => ({
  CLI_PACKAGE: "@markbase/cli",
  fetchLatestCliVersion: async () => "9.9.9",
  isVersionBehind: () => true,
}));
vi.mock("../src/service", () => ({ serviceInstalled: () => true }));

import { runUpdate } from "../src/update";
import { DESKTOP_APP_NOTE } from "../src/desktop-app";

let output: string[];
beforeEach(() => {
  spawned.length = 0;
  output = [];
  vi.spyOn(console, "log").mockImplementation((...args: string[]) => {
    output.push(args.join(" "));
  });
});
afterEach(() => vi.restoreAllMocks());

const installCalls = () => spawned.filter((call) => call.includes("install-service"));

describe("runUpdate with a service installed", () => {
  it("leaves the service alone next to the desktop app and says so", async () => {
    await runUpdate("1.0.0", [], async () => true);
    expect(installCalls()).toEqual([]);
    const text = output.join("\n");
    expect(text).toContain(DESKTOP_APP_NOTE);
    expect(text).toContain("markbase uninstall-service");
    expect(process.exitCode ?? 0).toBe(0);
  });

  it("restarts the service on the new version when there is no app", async () => {
    await runUpdate("1.0.0", [], async () => false);
    expect(installCalls()).toHaveLength(1);
    expect(output.join("\n")).not.toContain(DESKTOP_APP_NOTE);
  });
});
