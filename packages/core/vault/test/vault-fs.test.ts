import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  existsSync,
  rmSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  NodeVaultFs,
  NodeVaultBaseStore,
  listMarkdown,
  writeVaultMarker,
  isMarkdownPath,
} from "../src/vault-fs";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "vault-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("NodeVaultFs", () => {
  it("read / write / trash on real disk", () => {
    const fs = new NodeVaultFs(dir);
    expect(fs.read("a.md")).toBeNull();
    fs.write("a.md", "# A\n");
    expect(fs.read("a.md")).toBe("# A\n");
    expect(readFileSync(join(dir, "a.md"), "utf8")).toBe("# A\n");
    fs.trash("a.md");
    expect(fs.read("a.md")).toBeNull();
    expect(existsSync(join(dir, ".trash", "a.md"))).toBe(true); // retired, not gone
  });

  it("creates parent folders when writing nested paths", () => {
    new NodeVaultFs(dir).write("sub/deep/b.md", "# B\n");
    expect(readFileSync(join(dir, "sub/deep/b.md"), "utf8")).toBe("# B\n");
  });
});

// The startup scan and the live watcher have to agree on what a document is.
// They didn't: the scan filtered to .md, the watcher took anything — so a PNG
// dropped into a running vault was read as UTF-8 and adopted as mojibake, while
// the same PNG present at startup was correctly ignored. One predicate, both.
describe("isMarkdownPath", () => {
  it("accepts markdown, whatever the case", () => {
    expect(isMarkdownPath("notes.md")).toBe(true);
    expect(isMarkdownPath("projects/2026/q1.md")).toBe(true);
    expect(isMarkdownPath("SHOUTY.MD")).toBe(true);
  });

  it("rejects everything a vault folder collects alongside its notes", () => {
    expect(isMarkdownPath("diagram.png")).toBe(false);
    expect(isMarkdownPath("paper.pdf")).toBe(false);
    expect(isMarkdownPath("notes.txt")).toBe(false);
    expect(isMarkdownPath("README")).toBe(false);
    expect(isMarkdownPath("md")).toBe(false);
    expect(isMarkdownPath("not-md.png")).toBe(false); // ".md" appears, but not at the end
  });
});

describe("listMarkdown", () => {
  it("lists .md recursively, skipping dotfiles/.trash and non-md", () => {
    writeFileSync(join(dir, "a.md"), "a");
    mkdirSync(join(dir, "sub"));
    writeFileSync(join(dir, "sub/b.md"), "b");
    mkdirSync(join(dir, ".trash"));
    writeFileSync(join(dir, ".trash/old.md"), "x");
    writeFileSync(join(dir, "notes.txt"), "y");
    expect(listMarkdown(dir).sort()).toEqual(["a.md", "sub/b.md"]);
  });
});

describe("NodeVaultBaseStore (device-local sync state)", () => {
  it("persists the base OUTSIDE the synced vault folder and reloads it", () => {
    const vault = mkdtempSync(join(tmpdir(), "mb-vault-"));
    const stateDir = mkdtempSync(join(tmpdir(), "mb-state-"));
    try {
      const bs = new NodeVaultBaseStore(vault, stateDir);
      bs.save("doc-1", "shared base\n");
      // nothing written into the vault a file-drive would sync
      expect(readdirSync(vault)).toEqual([]);
      // persisted device-locally; a fresh instance for the same identity reloads it
      expect(readdirSync(stateDir).length).toBe(1);
      expect(new NodeVaultBaseStore(vault, stateDir).load("doc-1")).toBe("shared base\n");
    } finally {
      rmSync(vault, { recursive: true, force: true });
      rmSync(stateDir, { recursive: true, force: true });
    }
  });

  // Identity must be the VAULT, not the folder it happens to sit in. Keyed by
  // path, moving/repointing a vault orphaned its base — silently reintroducing
  // the offline clobber that A4 exists to prevent.
  it("keeps the base when a vault is repointed to a new folder", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "mb-state-"));
    try {
      const vaultId = "vault-work-123";
      new NodeVaultBaseStore(vaultId, stateDir).save("doc-1", "shared base\n");

      // the user moved ~/Work → ~/Documents/Work and repointed. Same vault, new
      // folder: the base must follow the vault.
      const afterMove = new NodeVaultBaseStore(vaultId, stateDir);
      expect(afterMove.load("doc-1")).toBe("shared base\n");
      expect(readdirSync(stateDir).length).toBe(1); // one file, not two
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it("keeps two vaults' bases apart", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "mb-state-"));
    try {
      new NodeVaultBaseStore("vault-work", stateDir).save("doc-1", "work base\n");
      new NodeVaultBaseStore("vault-personal", stateDir).save("doc-1", "personal base\n");
      // same doc id in two vaults must not collide
      expect(new NodeVaultBaseStore("vault-work", stateDir).load("doc-1")).toBe("work base\n");
      expect(new NodeVaultBaseStore("vault-personal", stateDir).load("doc-1")).toBe(
        "personal base\n"
      );
      expect(readdirSync(stateDir).length).toBe(2);
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
  });
});

describe("nested folders (A5)", () => {
  it("writes, lists, and reads a file in a subfolder with its path preserved", () => {
    const fs = new NodeVaultFs(dir);
    fs.write("projects/roadmap.md", "# Roadmap\n"); // subfolder is created recursively
    fs.write("top.md", "# Top\n");
    expect(listMarkdown(dir).sort()).toEqual(["projects/roadmap.md", "top.md"]);
    expect(fs.read("projects/roadmap.md")).toBe("# Roadmap\n");
  });
});
