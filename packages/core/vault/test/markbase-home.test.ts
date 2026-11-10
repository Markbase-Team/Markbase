import { describe, it, expect, afterEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { markbaseHome, legacyMarkbaseHome, migrateHome, registryPath } from "../src/markbase-home";

// Moving this directory moves the mount registry, every vault lock, and every
// sync base. Losing the registry makes every vault read as unmounted — that has
// happened, and a vault stayed lost for five days. Losing a sync base makes the
// next three-way merge run against nothing and discard work done offline.

const homes: string[] = [];
/** A throwaway home, via the same override a dev build uses. */
function fakeHome(): string {
  const h = mkdtempSync(join(tmpdir(), "home-"));
  homes.push(h);
  process.env.MARKBASE_HOME = join(h, ".markbaseConfig");
  process.env.MARKBASE_LEGACY_HOME = join(h, ".config", "markbase");
  return h;
}

/** An install as it was before the move. */
function seedLegacy(home: string): void {
  const old = join(home, ".config", "markbase");
  mkdirSync(join(old, "locks"), { recursive: true });
  mkdirSync(join(old, "vaults"), { recursive: true });
  writeFileSync(join(old, "config.json"), JSON.stringify({ vaults: [{ vaultId: "v1", name: "Blog", dir: "/x" }] }));
  writeFileSync(join(old, "locks", "v1.json"), "{}");
  writeFileSync(join(old, "vaults", "v1-abc.json"), '{"doc":"# hi"}');
}

afterEach(() => {
  delete process.env.MARKBASE_HOME;
  delete process.env.MARKBASE_LEGACY_HOME;
  for (const h of homes.splice(0)) rmSync(h, { recursive: true, force: true });
});

describe("moving out of ~/.config/markbase", () => {
  it("carries the registry, the locks and the sync bases", () => {
    const home = fakeHome();
    seedLegacy(home);

    const result = migrateHome();

    expect(result.migrated).toBe(true);
    expect(existsSync(registryPath())).toBe(true);
    expect(existsSync(join(markbaseHome(), "locks", "v1.json"))).toBe(true);
    expect(existsSync(join(markbaseHome(), "vaults", "v1-abc.json"))).toBe(true);
    // The registry must arrive with its contents, not merely exist.
    expect(JSON.parse(readFileSync(registryPath(), "utf8")).vaults).toHaveLength(1);
  });

  it("reports what arrived, so an empty move is visible", () => {
    const home = fakeHome();
    seedLegacy(home);
    const result = migrateHome();
    expect(result.moved).toContain("registry");
    expect(result.moved.join(" ")).toMatch(/1 lock/);
    expect(result.moved.join(" ")).toMatch(/1 sync base/);
  });

  it("does nothing when there is nothing to move", () => {
    fakeHome();
    expect(migrateHome()).toEqual({ migrated: false, moved: [] });
  });

  it("is a no-op the second time — the source is gone", () => {
    const home = fakeHome();
    seedLegacy(home);
    migrateHome();
    const again = migrateHome();
    expect(again.migrated).toBe(false);
    expect(existsSync(registryPath())).toBe(true); // still there
  });

  it("merges into a directory the new home already has", () => {
    // The failure this exists for: an empty locks/ at the destination — created
    // by anything that touched the path first — made the move step over the real
    // locks and sync bases and report success.
    const home = fakeHome();
    seedLegacy(home);
    mkdirSync(join(markbaseHome(), "locks"), { recursive: true });
    mkdirSync(join(markbaseHome(), "vaults"), { recursive: true });

    const result = migrateHome();

    expect(result.migrated).toBe(true);
    expect(existsSync(join(markbaseHome(), "locks", "v1.json"))).toBe(true);
    expect(existsSync(join(markbaseHome(), "vaults", "v1-abc.json"))).toBe(true);
  });

  it("never overwrites what the new home already has", () => {
    const home = fakeHome();
    seedLegacy(home);
    mkdirSync(markbaseHome(), { recursive: true });
    writeFileSync(registryPath(), '{"vaults":[{"vaultId":"newer"}]}');

    migrateHome();

    // The newer file was written after the move began; it wins.
    expect(JSON.parse(readFileSync(registryPath(), "utf8")).vaults[0].vaultId).toBe("newer");
  });

  it("leaves the old directory alone when the move fails", () => {
    const home = fakeHome();
    seedLegacy(home);
    const legacy = legacyMarkbaseHome();
    // A destination that cannot be created: its parent is a file, so mkdir fails
    // with ENOTDIR. (A null byte in the path does not work — an environment
    // variable cannot hold one, and it is silently truncated to a valid path.)
    const blocker = join(home, "blocker");
    writeFileSync(blocker, "not a directory");
    process.env.MARKBASE_HOME = join(blocker, "markbaseConfig");

    const result = migrateHome();

    expect(result.migrated).toBe(false);
    expect(existsSync(join(legacy, "config.json"))).toBe(true);
  });
});

describe("the paths themselves", () => {
  it("all sit under one directory", () => {
    fakeHome();
    expect(registryPath().startsWith(markbaseHome())).toBe(true);
    expect(markbaseHome().endsWith(".markbaseConfig")).toBe(true);
  });
});
