import { describe, it, expect } from "vitest";
import {
  assignFilenames,
  bodyHash,
  decideAction,
  mirrorFilename,
  readMirrorMeta,
  stripMirrorMeta,
  withMirrorMeta,
} from "../src/mirror-format";

const ID = "74cd8aaa-3f21-4c19-9a11-b0c2d3e4f5a6";

describe("mirror frontmatter", () => {
  it("round-trips a plain document without inventing frontmatter", () => {
    const md = "# Roadmap\n\nShip the mirror.\n";
    const file = withMirrorMeta(md, ID, 42);
    expect(readMirrorMeta(file)).toEqual({ id: ID, version: 42 });
    // Our keys come back off cleanly — the doc never gains a frontmatter node.
    expect(stripMirrorMeta(file)).toBe(md);
  });

  it("preserves the document's own frontmatter, verbatim", () => {
    const md = "---\ntags:\n  - a\n  - b\nauthor: jessie\n---\n# Doc\n\nBody\n";
    const file = withMirrorMeta(md, ID, 7);
    expect(readMirrorMeta(file)).toEqual({ id: ID, version: 7 });
    // Round-tripping must not reformat the user's YAML (lists, nesting, order).
    expect(stripMirrorMeta(file)).toContain("tags:\n  - a\n  - b");
    expect(stripMirrorMeta(file)).toContain("author: jessie");
    expect(stripMirrorMeta(file)).toContain("# Doc");
  });

  it("is idempotent — re-stamping doesn't duplicate our keys", () => {
    const once = withMirrorMeta("# D\n", ID, 1);
    const twice = withMirrorMeta(once, ID, 2);
    expect(readMirrorMeta(twice)).toEqual({ id: ID, version: 2 });
    expect(twice.match(/markbase_id:/g)).toHaveLength(1);
    expect(stripMirrorMeta(twice)).toBe("# D\n");
  });

  it("reports no id for a file the user just dropped in", () => {
    expect(readMirrorMeta("# Notes\n")).toEqual({ id: null, version: null });
    expect(readMirrorMeta("---\ntags: x\n---\n# Notes\n")).toEqual({
      id: null,
      version: null,
    });
  });

  it("leaves a file with no frontmatter alone when stripping", () => {
    expect(stripMirrorMeta("# Plain\n")).toBe("# Plain\n");
  });

  it("hashes the body, so our version stamp never counts as a change", () => {
    const md = "# D\n\nsame text\n";
    expect(bodyHash(stripMirrorMeta(withMirrorMeta(md, ID, 1)))).toBe(
      bodyHash(stripMirrorMeta(withMirrorMeta(md, ID, 99)))
    );
  });
});

describe("mirrorFilename", () => {
  it("makes a readable name from the title", () => {
    expect(mirrorFilename("Roadmap", ID)).toBe("Roadmap.md");
    expect(mirrorFilename("Q3  planning", ID)).toBe("Q3 planning.md");
  });

  it("strips characters that would escape the folder or break Windows", () => {
    expect(mirrorFilename("a/b", ID)).toBe("a b.md");
    expect(mirrorFilename("../../etc/passwd", ID)).toBe("etc passwd.md");
    expect(mirrorFilename("what?:*", ID)).toBe("what.md");
  });

  it("falls back to the id rather than producing a dotfile or an empty name", () => {
    expect(mirrorFilename("", ID)).toBe(`${ID}.md`);
    expect(mirrorFilename("...", ID)).toBe(`${ID}.md`);
    expect(mirrorFilename("CON", ID)).toBe(`${ID}.md`);
  });

  it("disambiguates duplicate titles so two docs can't fight over one path", () => {
    const a = { id: ID, title: "Roadmap" };
    const b = { id: "9b02c1de-77aa-4000-8000-000000000000", title: "Roadmap" };
    const c = { id: "1e02c1de-77aa-4000-8000-000000000000", title: "Other" };
    const names = assignFilenames([a, b, c]);
    expect(names.get(a.id)).toBe("Roadmap-74cd8aaa.md");
    expect(names.get(b.id)).toBe("Roadmap-9b02c1de.md");
    expect(names.get(c.id)).toBe("Other.md"); // unique titles stay clean
  });
});

describe("decideAction", () => {
  const state = { version: 5, hash: "aaa" };

  it("pulls a document it has never seen", () => {
    expect(
      decideAction({
        state: undefined,
        fileExists: false,
        fileHash: null,
        fileHasId: true,
        serverVersion: 5,
      })
    ).toEqual({ kind: "pull" });
  });

  it("pushes when only the file changed", () => {
    expect(
      decideAction({
        state,
        fileExists: true,
        fileHash: "bbb",
        fileHasId: true,
        serverVersion: 5,
      })
    ).toEqual({ kind: "push" });
  });

  it("pulls when only the server changed", () => {
    expect(
      decideAction({
        state,
        fileExists: true,
        fileHash: "aaa",
        fileHasId: true,
        serverVersion: 6,
      })
    ).toEqual({ kind: "pull" });
  });

  it("conflicts when both changed — never silently drops the browser's edit", () => {
    expect(
      decideAction({
        state,
        fileExists: true,
        fileHash: "bbb",
        fileHasId: true,
        serverVersion: 6,
      })
    ).toEqual({ kind: "conflict" });
  });

  it("does nothing when neither side moved", () => {
    expect(
      decideAction({
        state,
        fileExists: true,
        fileHash: "aaa",
        fileHasId: true,
        serverVersion: 5,
      })
    ).toEqual({ kind: "noop" });
  });

  it("restores a vanished file instead of deleting the document", () => {
    // `git checkout`, a crashed editor, an over-eager cleanup script — none of
    // these should be able to destroy a document.
    expect(
      decideAction({
        state,
        fileExists: false,
        fileHash: null,
        fileHasId: true,
        serverVersion: 5,
      })
    ).toEqual({ kind: "restore" });
  });

  it("adopts an untracked markdown file as a new document", () => {
    expect(
      decideAction({
        state: undefined,
        fileExists: true,
        fileHash: "ccc",
        fileHasId: false,
        serverVersion: null,
      })
    ).toEqual({ kind: "create" });
  });
});
