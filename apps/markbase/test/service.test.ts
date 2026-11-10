import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { installServiceAfterSetup, runInstallService, type ServiceDeps } from "../src/service";
import { DESKTOP_APP_NOTE } from "../src/desktop-app";

// The rule: a Mac with the desktop app gets no service from `login`/`init`
// (the app is the worker), while `markbase install-service` by name still
// installs — and both say so in one line that points at the app.

function deps(appInstalled: boolean): ServiceDeps & { install: ReturnType<typeof vi.fn> } {
  return { detectDesktopApp: async () => appInstalled, install: vi.fn(async () => {}) };
}

let output: string[];
beforeEach(() => {
  output = [];
  vi.spyOn(console, "log").mockImplementation((...args: string[]) => {
    output.push(args.join(" "));
  });
});
afterEach(() => vi.restoreAllMocks());

describe("installServiceAfterSetup (login / init)", () => {
  it("skips the service and points at the app when the app is installed", async () => {
    const d = deps(true);
    await installServiceAfterSetup(d);
    expect(d.install).not.toHaveBeenCalled();
    expect(output.join("\n")).toContain(DESKTOP_APP_NOTE);
    expect(output.join("\n")).toContain("markbase install-service");
  });

  it("installs as before when the app is not installed", async () => {
    const d = deps(false);
    await installServiceAfterSetup(d);
    expect(d.install).toHaveBeenCalledTimes(1);
    expect(output.join("\n")).not.toContain(DESKTOP_APP_NOTE);
  });
});

describe("runInstallService (explicit `markbase install-service`)", () => {
  it("still installs when the app is present, but says the service is redundant", async () => {
    const d = deps(true);
    await runInstallService(d);
    expect(d.install).toHaveBeenCalledTimes(1);
    expect(output.join("\n")).toContain(DESKTOP_APP_NOTE);
  });

  it("installs quietly when the app is absent", async () => {
    const d = deps(false);
    await runInstallService(d);
    expect(d.install).toHaveBeenCalledTimes(1);
    expect(output.join("\n")).not.toContain(DESKTOP_APP_NOTE);
  });
});
