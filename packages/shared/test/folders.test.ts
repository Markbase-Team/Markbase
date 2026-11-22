import { describe, it, expect } from "vitest";
import {
  normalizePath,
  folderOf,
  listFolders,
  buildFolderTree,
  renameFolder,
  moveFolder,
  filesUnder,
  filePathIn,
  rebaseToVaultRoot,
  type Move,
} from "../src/folders";

// A vault's folder structure lives in the document paths themselves — the way
// Obsidian, git and iCloud all work — so local disk, web, and electron all
// manipulate the SAME representation. These tests pin that shared logic; each
// surface only differs in how it *applies* the resulting moves.
const FILES = [
  "inbox.md",
  "projects/roadmap.md",
  "projects/2026/q1.md",
  "projects/2026/q2.md",
  "projects/2026/deep/notes.md",
  "archive/old.md",
];

describe("paths & nesting", () => {
  it("normalizes separators and strips stray slashes/dots", () => {
    expect(normalizePath("/a/b/c.md")).toBe("a/b/c.md");
    expect(normalizePath("a\\b\\c.md")).toBe("a/b/c.md");
    expect(normalizePath("./a//b/c.md")).toBe("a/b/c.md");
    expect(normalizePath("a/b/")).toBe("a/b");
  });

  it("resolves the folder a file lives in (root = empty string)", () => {
    expect(folderOf("projects/2026/q1.md")).toBe("projects/2026");
    expect(folderOf("inbox.md")).toBe("");
  });

  it("lists every folder implied by nested paths, including intermediates", () => {
    expect(listFolders(FILES)).toEqual([
      "archive",
      "projects",
      "projects/2026",
      "projects/2026/deep",
    ]);
  });

  it("builds a nested tree for the web/electron file tree", () => {
    const root = buildFolderTree(FILES);
    expect(root.files).toEqual(["inbox.md"]); // root-level docs
    const names = root.folders.map((f) => f.name);
    expect(names).toEqual(["archive", "projects"]);

    const projects = root.folders.find((f) => f.name === "projects")!;
    expect(projects.files).toEqual(["projects/roadmap.md"]);
    const y2026 = projects.folders.find((f) => f.name === "2026")!;
    expect(y2026.path).toBe("projects/2026");
    expect(y2026.files).toEqual(["projects/2026/q1.md", "projects/2026/q2.md"]);
    // nesting keeps going
    expect(y2026.folders[0].path).toBe("projects/2026/deep");
    expect(y2026.folders[0].files).toEqual(["projects/2026/deep/notes.md"]);
  });
});

describe("creating a folder & adding files under it", () => {
  it("adds a file under a folder (creating the folder implicitly)", () => {
    expect(filePathIn("projects/2026", "q3.md")).toBe("projects/2026/q3.md");
    expect(filePathIn("", "top.md")).toBe("top.md"); // root
  });

  it("shows an explicitly-created empty folder that has no files yet", () => {
    // A vault directory can be empty; paths alone can't express that, so empty
    // folders are carried explicitly (a real dir locally, a folder row in cloud).
    expect(listFolders(["a/x.md"], ["a/empty"])).toEqual(["a", "a/empty"]);
    const root = buildFolderTree(["a/x.md"], ["a/empty"]);
    const a = root.folders.find((f) => f.name === "a")!;
    expect(a.folders.map((f) => f.name)).toEqual(["empty"]);
    expect(a.folders[0].files).toEqual([]);
  });
});

describe("renaming a folder", () => {
  it("rewrites every descendant path, however deeply nested", () => {
    const moves = renameFolder(FILES, "projects/2026", "2027");
    expect(moves).toEqual<Move[]>([
      { from: "projects/2026/q1.md", to: "projects/2027/q1.md" },
      { from: "projects/2026/q2.md", to: "projects/2027/q2.md" },
      { from: "projects/2026/deep/notes.md", to: "projects/2027/deep/notes.md" },
    ]);
  });

  it("leaves files outside the folder untouched", () => {
    const moves = renameFolder(FILES, "archive", "old-stuff");
    expect(moves).toEqual<Move[]>([{ from: "archive/old.md", to: "old-stuff/old.md" }]);
  });

  it("rejects a name that would collide with a sibling folder", () => {
    expect(() => renameFolder(FILES, "archive", "projects")).toThrow(/exists/i);
  });

  it("rejects a name containing a path separator", () => {
    expect(() => renameFolder(FILES, "archive", "a/b")).toThrow(/separator/i);
  });
});

describe("moving a folder", () => {
  it("moves a folder (and its whole subtree) under a new parent", () => {
    const moves = moveFolder(FILES, "projects/2026", "archive");
    expect(moves).toEqual<Move[]>([
      { from: "projects/2026/q1.md", to: "archive/2026/q1.md" },
      { from: "projects/2026/q2.md", to: "archive/2026/q2.md" },
      { from: "projects/2026/deep/notes.md", to: "archive/2026/deep/notes.md" },
    ]);
  });

  it("moves a folder to the vault root", () => {
    const moves = moveFolder(FILES, "projects/2026", "");
    expect(moves).toEqual<Move[]>([
      { from: "projects/2026/q1.md", to: "2026/q1.md" },
      { from: "projects/2026/q2.md", to: "2026/q2.md" },
      { from: "projects/2026/deep/notes.md", to: "2026/deep/notes.md" },
    ]);
  });

  it("refuses to move a folder into itself or its own descendant", () => {
    expect(() => moveFolder(FILES, "projects", "projects/2026")).toThrow(/into itself|descendant/i);
    expect(() => moveFolder(FILES, "projects", "projects")).toThrow(/into itself|descendant/i);
  });

  it("refuses a move that would collide at the destination", () => {
    // archive already exists at root, so moving another "archive" there collides
    const files = ["archive/old.md", "projects/archive/x.md"];
    expect(() => moveFolder(files, "projects/archive", "")).toThrow(/exists/i);
  });
});

describe("deleting a folder", () => {
  it("returns every file under it, including nested ones", () => {
    expect(filesUnder(FILES, "projects/2026")).toEqual([
      "projects/2026/q1.md",
      "projects/2026/q2.md",
      "projects/2026/deep/notes.md",
    ]);
  });

  it("does not match a sibling folder that shares a name prefix", () => {
    const files = ["proj/a.md", "projects/b.md"];
    expect(filesUnder(files, "proj")).toEqual(["proj/a.md"]); // not projects/b.md
  });

  it("deleting the root folder of a subtree takes the whole subtree", () => {
    expect(filesUnder(FILES, "projects")).toEqual([
      "projects/roadmap.md",
      "projects/2026/q1.md",
      "projects/2026/q2.md",
      "projects/2026/deep/notes.md",
    ]);
  });
});

// Converting a folder into its own vault. A path is vault-RELATIVE, so the paths
// cannot simply come along: the folder that was a prefix is now the root. Leave
// the prefix in and the new vault nests one level inside its own folder on every
// device — ~/Projects/projects/2026/q1.md.
describe("rebaseToVaultRoot — a folder becomes a vault of its own", () => {
  it("strips the folder prefix, keeping the structure inside it", () => {
    const files = ["projects/roadmap.md", "projects/2026/q1.md", "projects/2026/deep/x.md"];
    expect(rebaseToVaultRoot(files, "projects")).toEqual<Move[]>([
      { from: "projects/roadmap.md", to: "roadmap.md" },
      { from: "projects/2026/q1.md", to: "2026/q1.md" },
      { from: "projects/2026/deep/x.md", to: "2026/deep/x.md" },
    ]);
  });

  it("leaves everything outside the folder alone", () => {
    const files = ["projects/a.md", "inbox.md", "archive/b.md"];
    expect(rebaseToVaultRoot(files, "projects")).toEqual<Move[]>([
      { from: "projects/a.md", to: "a.md" },
    ]);
  });

  it("converts a nested folder, rebasing from that folder down", () => {
    const files = ["projects/2026/q1.md", "projects/2026/deep/x.md", "projects/roadmap.md"];
    expect(rebaseToVaultRoot(files, "projects/2026")).toEqual<Move[]>([
      { from: "projects/2026/q1.md", to: "q1.md" },
      { from: "projects/2026/deep/x.md", to: "deep/x.md" },
    ]);
  });

  it("is segment-aware — converting 'proj' never takes 'projects'", () => {
    const files = ["proj/a.md", "projects/b.md"];
    expect(rebaseToVaultRoot(files, "proj")).toEqual<Move[]>([
      { from: "proj/a.md", to: "a.md" },
    ]);
  });

  it("refuses to convert the root — that's the vault it already is", () => {
    expect(() => rebaseToVaultRoot(["a.md"], "")).toThrow(/root/i);
  });

  it("is a no-op for a folder with no files", () => {
    expect(rebaseToVaultRoot(["inbox.md"], "empty")).toEqual([]);
  });
});

describe("one shared operation — local, web, and electron apply the same moves", () => {
  it("a folder move computes identical moves regardless of which surface triggers it", () => {
    // The local vault applies these via VaultSyncManager.moveDoc, the web via a
    // doc-path update, electron via the vault it embeds. Same input, same moves.
    const fromLocalDrag = moveFolder(FILES, "archive", "projects");
    const fromWebDrag = moveFolder(FILES, "archive", "projects");
    const fromElectron = moveFolder(FILES, "archive", "projects");
    expect(fromLocalDrag).toEqual(fromWebDrag);
    expect(fromWebDrag).toEqual(fromElectron);
    expect(fromLocalDrag).toEqual<Move[]>([
      { from: "archive/old.md", to: "projects/archive/old.md" },
    ]);
  });
});
