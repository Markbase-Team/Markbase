import { describe, it, expect } from "vitest";
import { resolveRef, refsIn, referencedAssets } from "../src/asset-refs";

// Resolution is where this earns its keep. A reference we fail to resolve is an
// image that silently never uploads — worse than uploading too much, because it
// looks like nothing happened at all.

describe("resolving one reference", () => {
  const at = (doc: string, ref: string) => resolveRef(doc, ref);

  it("resolves relative to the document's own folder", () => {
    expect(at("notes/guide.md", "img/a.png")).toBe("notes/img/a.png");
    expect(at("guide.md", "a.png")).toBe("a.png");
    expect(at("a/b/c.md", "../shared/x.png")).toBe("a/shared/x.png");
    expect(at("notes/guide.md", "./a.png")).toBe("notes/a.png");
  });

  it("treats a leading slash as the VAULT root, not the disk root", () => {
    expect(at("deep/nested/doc.md", "/assets/logo.png")).toBe("assets/logo.png");
  });

  it("decodes percent-escapes, because disk has the space and the link has %20", () => {
    expect(at("notes/g.md", "my%20diagram.png")).toBe("notes/my diagram.png");
    expect(at("notes/g.md", "a%2Bb.png")).toBe("notes/a+b.png");
  });

  it("drops the fragment and query a reference may carry", () => {
    expect(at("g.md", "a.pdf#page=2")).toBe("a.pdf");
    expect(at("g.md", "a.png?v=3")).toBe("a.png");
  });

  it("handles the markdown title and angle-bracket forms", () => {
    expect(at("g.md", 'a.png "My title"')).toBe("a.png");
    expect(at("g.md", "<my file.png>")).toBe("my file.png");
  });

  it("ignores anything that is not a file in this vault", () => {
    expect(at("g.md", "https://example.com/a.png")).toBeNull();
    expect(at("g.md", "//cdn.example.com/a.png")).toBeNull();
    expect(at("g.md", "data:image/png;base64,iVBOR")).toBeNull();
    expect(at("g.md", "#heading")).toBeNull();
    expect(at("g.md", "")).toBeNull();
  });

  it("refuses a path that climbs out of the vault", () => {
    // ../../etc/passwd is not media this vault may upload.
    expect(at("g.md", "../secret.png")).toBeNull();
    expect(at("a/b.md", "../../../outside.png")).toBeNull();
  });
});

describe("finding references in a document", () => {
  it("finds markdown images and inline HTML alike", () => {
    const md = [
      "# Notes",
      "![a diagram](assets/d.png)",
      'Some prose with <img src="img/inline.png" alt="x"> in it.',
      "![](spaced%20name.png)",
      "[a link](not-an-image.md) should not count",
      "![remote](https://example.com/x.png)",
    ].join("\n");
    expect(refsIn("notes/g.md", md).sort()).toEqual([
      "notes/assets/d.png",
      "notes/img/inline.png",
      "notes/spaced name.png",
    ]);
  });

  it("deduplicates across documents", () => {
    const set = referencedAssets([
      { path: "a.md", markdown: "![](shared/logo.png)" },
      { path: "b.md", markdown: "![](shared/logo.png) and ![](b-only.png)" },
    ]);
    expect([...set].sort()).toEqual(["b-only.png", "shared/logo.png"]);
  });

  it("returns nothing for a document with no images", () => {
    expect(refsIn("g.md", "# Just words\n\nand [a link](other.md).")).toEqual([]);
  });
});
