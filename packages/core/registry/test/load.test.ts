import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadFeatures, enabledFeatures, repoRoot } from "../src/load";

/**
 * A throwaway `packages/features/` tree, so these tests never depend on the
 * real one. The path matters: the loader scans `packages/features/*` and
 * deliberately skips `packages/core/*`, because the kernel ships in every
 * release and has nothing for a manifest to decide.
 */
function fixture(
  features: Record<string, { manifest?: unknown; pkgName?: string | null }>
): string {
  const root = mkdtempSync(join(tmpdir(), "mb-features-"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "fixture" }));
  for (const [dir, { manifest, pkgName }] of Object.entries(features)) {
    const pkgDir = join(root, "packages", "features", dir);
    mkdirSync(pkgDir, { recursive: true });
    if (manifest !== undefined) {
      const body =
        typeof manifest === "string" ? manifest : JSON.stringify(manifest);
      writeFileSync(join(pkgDir, "markbase.json"), body);
    }
    if (pkgName !== null) {
      writeFileSync(
        join(pkgDir, "package.json"),
        JSON.stringify({ name: pkgName ?? `@markbase/${dir}` })
      );
    }
  }
  return root;
}

const manifest = (id: string, requires: string[] = []) => ({
  id,
  pkg: `@markbase/${id}`,
  summary: `${id}.`,
  requires,
});

describe("loadFeatures", () => {
  it("ignores a package with no manifest", () => {
    const root = fixture({ docs: { manifest: manifest("docs") }, ui: {} });
    expect(loadFeatures(root).map((f) => f.manifest.id)).toEqual(["docs"]);
    rmSync(root, { recursive: true });
  });

  // Generated output (transpilePackages, the sidebar) is committed and diffed.
  // If the order followed readdir, the same manifests would regenerate
  // differently on another machine and every build would look like a change.
  it("sorts by id so generated output is stable", () => {
    const root = fixture({
      zed: { manifest: manifest("zed") },
      docs: { manifest: manifest("docs") },
      mid: { manifest: manifest("mid") },
    });
    expect(loadFeatures(root).map((f) => f.manifest.id)).toEqual([
      "docs",
      "mid",
      "zed",
    ]);
    rmSync(root, { recursive: true });
  });

  it("names the offending file when a manifest is invalid", () => {
    const root = fixture({ docs: { manifest: { id: "docs" } } });
    expect(() => loadFeatures(root)).toThrow(/docs[\\/]markbase\.json/);
    rmSync(root, { recursive: true });
  });

  it("names the offending file when a manifest is not JSON", () => {
    const root = fixture({ docs: { manifest: "{ nope" } });
    expect(() => loadFeatures(root)).toThrow(/not valid JSON/);
    rmSync(root, { recursive: true });
  });

  // A manifest that disagrees with its own package.json would generate a
  // transpilePackages entry for a package that does not exist, and Next would
  // simply not compile the real one.
  it("rejects a manifest whose pkg disagrees with its package.json", () => {
    const root = fixture({
      docs: { manifest: manifest("docs"), pkgName: "@markbase/documents" },
    });
    expect(() => loadFeatures(root)).toThrow(/declares pkg/);
    rmSync(root, { recursive: true });
  });

  // The kernel ships in every release, so a manifest there would declare
  // something no build can act on. Scanning it would also make every core
  // package look droppable to the boundary test.
  it("does not scan packages/core", () => {
    const root = fixture({ docs: { manifest: manifest("docs") } });
    const core = join(root, "packages", "core", "vault");
    mkdirSync(core, { recursive: true });
    writeFileSync(join(core, "package.json"), JSON.stringify({ name: "@markbase/vault" }));
    writeFileSync(join(core, "markbase.json"), JSON.stringify(manifest("vault")));
    expect(loadFeatures(root).map((f) => f.manifest.id)).toEqual(["docs"]);
    rmSync(root, { recursive: true });
  });

  it("rejects two features claiming the same id", () => {
    const root = fixture({
      a: { manifest: { ...manifest("dup"), pkg: "@markbase/a" }, pkgName: "@markbase/a" },
      b: { manifest: { ...manifest("dup"), pkg: "@markbase/b" }, pkgName: "@markbase/b" },
    });
    expect(() => loadFeatures(root)).toThrow(/Duplicate feature id: dup/);
    rmSync(root, { recursive: true });
  });
});

describe("the real workspace", () => {
  it("every manifest on disk loads and agrees with its package.json", () => {
    const found = loadFeatures(repoRoot());
    expect(found.length).toBeGreaterThan(0);
    expect(found.map((f) => f.manifest.id)).toContain("docs");
  });
});

describe("enabledFeatures", () => {
  const all = [
    { manifest: manifest("attention"), dir: "attention" },
    { manifest: manifest("docs"), dir: "docs" },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ] as any;

  // Forgetting the variable ships the released product, never nothing and
  // never everything: what is in a build is a release decision.
  it("treats unset and empty as the released set", () => {
    // `undefined` means "read the environment", so the environment must not
    // say otherwise — a test run under MARKBASE_FEATURES=all would see all.
    delete process.env.MARKBASE_FEATURES;
    for (const spec of [undefined, "", "   "]) {
      expect(enabledFeatures(all, spec).map((f: any) => f.manifest.id)).toEqual(["docs"]);
    }
  });

  it("ships everything only when asked for `all`", () => {
    expect(enabledFeatures(all, "all")).toHaveLength(2);
    expect(enabledFeatures(all, " all ")).toHaveLength(2);
  });

  it("narrows to the named features", () => {
    expect(enabledFeatures(all, "docs").map((f: any) => f.manifest.id)).toEqual([
      "docs",
    ]);
  });

  it("tolerates whitespace around the names", () => {
    expect(enabledFeatures(all, " docs , attention ")).toHaveLength(2);
  });

  // Silently matching nothing is how a build ships without a feature someone
  // believed was in it.
  it("throws on an unknown name rather than matching nothing", () => {
    expect(() => enabledFeatures(all, "docs,reader")).toThrow(/reader/);
    expect(() => enabledFeatures(all, "docs,reader")).toThrow(/Known: /);
  });

  // A feature that composes another cannot ship without it, and a build gets a
  // feature only by naming it — so the dependant without the dependency is a
  // refusal that names the fix, not a quiet addition.
  it("refuses a feature whose requirement is not enabled", () => {
    const withRequirement = [
      { manifest: manifest("attention", ["email"]), dir: "attention" },
      { manifest: manifest("docs"), dir: "docs" },
      { manifest: manifest("email"), dir: "email" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any;
    expect(() => enabledFeatures(withRequirement, "docs,attention")).toThrow(
      /"attention" requires email/
    );
    expect(
      enabledFeatures(withRequirement, "docs,attention,email").map((f: any) => f.manifest.id)
    ).toEqual(["attention", "docs", "email"]);
    expect(enabledFeatures(withRequirement, "all")).toHaveLength(3);
  });
});
