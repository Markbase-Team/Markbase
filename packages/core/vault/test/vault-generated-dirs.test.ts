import { describe, it, expect } from "vitest";
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listMarkdown } from "../src/vault-fs";
import { listDiskAssets } from "../src/vault-assets";
import { ignoredByWatcher, GENERATED_DIRS } from "../src/vault-boundary";

// Pointing a vault at a code repo adopted 398 dependency READMEs as cloud
// documents in twenty minutes, heading for 11,026. Dot-directories were skipped;
// node_modules is not dotted.
describe("a vault never walks into a dependency tree", () => {
  it("skips node_modules while keeping the user's own files", () => {
    const root = mkdtempSync(join(tmpdir(), "vendor-"));
    try {
      writeFileSync(join(root, "notes.md"), "# mine");
      mkdirSync(join(root, "docs"), { recursive: true });
      writeFileSync(join(root, "docs", "guide.md"), "# also mine");
      mkdirSync(join(root, "node_modules", "typescript"), { recursive: true });
      writeFileSync(join(root, "node_modules", "typescript", "README.md"), "# not mine");
      mkdirSync(join(root, "api", "node_modules", "ufo"), { recursive: true });
      writeFileSync(join(root, "api", "node_modules", "ufo", "README.md"), "# nested, still not mine");

      const found = listMarkdown(root).sort();
      expect(found).toEqual(["docs/guide.md", "notes.md"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("skips them for ASSETS as well, not just documents", () => {
    // Fixing only the markdown walker left this one uploading 15 MB of Android
    // build intermediates. Two walkers over one folder must agree on what is in it.
    const root = mkdtempSync(join(tmpdir(), "vendor-assets-"));
    try {
      mkdirSync(join(root, "assets"), { recursive: true });
      writeFileSync(join(root, "assets", "diagram.png"), "mine");
      mkdirSync(join(root, "app", "build", "intermediates", "image"), { recursive: true });
      writeFileSync(join(root, "app", "build", "intermediates", "image", "faceMask.png"), "generated");
      mkdirSync(join(root, "node_modules", "pkg"), { recursive: true });
      writeFileSync(join(root, "node_modules", "pkg", "logo.png"), "vendored");

      expect(listDiskAssets(root).map((a) => a.path)).toEqual(["assets/diagram.png"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("ignores vendor paths in the watcher too, at any depth", () => {
    // The walker and the watcher have to agree, or a file the scan skipped is
    // adopted the moment it changes.
    expect(ignoredByWatcher("node_modules/typescript/README.md")).toBe(true);
    expect(ignoredByWatcher("API-Gateway/node_modules/ufo/README.md")).toBe(true);
    expect(ignoredByWatcher("vendor/x/README.md")).toBe(true);
    expect(ignoredByWatcher("NeuroSpark-Awesome-Skill/dist/skill.md")).toBe(true);
    expect(ignoredByWatcher("api/build/notes.md")).toBe(true);
    expect(ignoredByWatcher("web/out/index.md")).toBe(true);
    expect(ignoredByWatcher("docs/guide.md")).toBe(false);
    // Not a false positive on a real document that merely mentions one.
    expect(ignoredByWatcher("notes/about node_modules.md")).toBe(false);
  });
});

// The asymmetry that bit hardest: skipping generated dirs on DISK while still
// honouring them in the CLOUD list means every asset uploaded there before the
// fix reads as "missing locally" on every pass — and the download half fetches it
// back into node_modules, forever. Both sides must apply the same rule.
describe("the cloud list is filtered the same way", () => {
  const generated = (p: string): boolean =>
    p.split("/").some((seg) => GENERATED_DIRS.has(seg));

  it("refuses to download an asset into a generated directory", () => {
    expect(generated("node_modules/editor.md/fonts/OpenSans.svg")).toBe(true);
    expect(generated("themes/x/dist/logo.png")).toBe(true);
    expect(generated("source/_posts/diagram.png")).toBe(false);
  });

  it("agrees with the walker, so nothing is uploaded that would be re-downloaded", () => {
    // A path the disk scan skips must also be one the cloud plan ignores, or the
    // two disagree about what the folder contains and fight each other.
    for (const p of [
      "node_modules/pkg/a.png",
      "api/build/b.png",
      "web/out/c.png",
      "vendor/d.png",
    ]) {
      expect(generated(p)).toBe(true);
      expect(ignoredByWatcher(p)).toBe(true);
    }
  });
});
