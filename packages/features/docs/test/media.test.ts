import { describe, it, expect } from "vitest";
import {
  imageRefs,
  rewriteImageRefs,
  isExternalRef,
  assetPathFor,
  MediaRegistry,
  selectOrphans,
  type ImageRef,
} from "../src/logic/media";

// Media in a vault (roadmap A6).
//
// The markdown holds a VAULT-RELATIVE path — "assets/diagram.png" — never a
// Supabase URL. That's the whole portability promise: the vault is markdown in a
// folder, so it has to keep working in Obsidian, in git, and offline. A remote URL
// baked into the text breaks all three, and rots the day someone stops paying us.
//
// So each surface resolves the path instead: the web maps it to a storage URL to
// render, and on disk the file is simply there. Rewriting is text surgery on raw
// markdown (Y.Text is the truth), so it must be careful about what it touches.

describe("imageRefs", () => {
  it("finds an inline image and where it sits", () => {
    const md = "# Doc\n\n![a diagram](assets/diagram.png)\n";
    const refs = imageRefs(md);
    expect(refs).toEqual<ImageRef[]>([
      { alt: "a diagram", target: "assets/diagram.png", start: 7, end: 39 },
    ]);
    // the span covers exactly the whole reference — rewriting depends on it
    expect(md.slice(refs[0].start, refs[0].end)).toBe("![a diagram](assets/diagram.png)");
  });

  it("finds several, including an empty alt", () => {
    const md = "![](a.png) text ![two](b/c.jpg)";
    expect(imageRefs(md).map((r) => r.target)).toEqual(["a.png", "b/c.jpg"]);
    expect(imageRefs(md).map((r) => r.alt)).toEqual(["", "two"]);
  });

  it("keeps the title out of the target", () => {
    expect(imageRefs('![x](assets/a.png "My title")').map((r) => r.target)).toEqual([
      "assets/a.png",
    ]);
  });

  it("is not fooled by a plain link", () => {
    expect(imageRefs("[not an image](page.md)")).toEqual([]);
  });

  // Rewriting inside code would corrupt content the user wrote ON PURPOSE —
  // documentation about markdown is exactly the kind of thing people keep here.
  it("ignores images inside a fenced code block", () => {
    const md = "before\n\n```\n![x](assets/a.png)\n```\n\n![real](assets/b.png)\n";
    expect(imageRefs(md).map((r) => r.target)).toEqual(["assets/b.png"]);
  });

  it("ignores images inside a tilde fence and an indented fence", () => {
    const md = "~~~\n![x](a.png)\n~~~\n\n```js\n![y](b.png)\n```\n\n![real](c.png)";
    expect(imageRefs(md).map((r) => r.target)).toEqual(["c.png"]);
  });

  it("ignores an image inside an inline code span", () => {
    expect(imageRefs("use `![x](a.png)` for images")).toEqual([]);
  });

  // A pasted screenshot is named "Screenshot 2026-07-21 at 12.13.52 PM.png" — the
  // space is part of the path. A bare `[^)\s]+` target silently dropped these, so
  // the image rendered as raw text / a dead link. Both forms must be found.
  it("finds an image whose path contains spaces (a pasted screenshot)", () => {
    const md = "![shot](assets/Screenshot 2026-07-21 at 12.13.52 PM.png)";
    const refs = imageRefs(md);
    expect(refs.map((r) => r.target)).toEqual([
      "assets/Screenshot 2026-07-21 at 12.13.52 PM.png",
    ]);
    expect(md.slice(refs[0].start, refs[0].end)).toBe(md); // span covers the whole ref
  });

  it("finds a <>-wrapped target, and keeps a title out of a spaced target", () => {
    expect(imageRefs("![a](<assets/a b.png>)").map((r) => r.target)).toEqual(["assets/a b.png"]);
    expect(imageRefs('![a](assets/a b.png "t")').map((r) => r.target)).toEqual(["assets/a b.png"]);
  });
});

describe("isExternalRef — what we must NOT touch", () => {
  it("treats real URLs and data URIs as external", () => {
    expect(isExternalRef("https://example.com/x.png")).toBe(true);
    expect(isExternalRef("http://example.com/x.png")).toBe(true);
    expect(isExternalRef("//cdn.example.com/x.png")).toBe(true);
    expect(isExternalRef("data:image/png;base64,AAA")).toBe(true);
  });

  it("treats vault paths as ours", () => {
    expect(isExternalRef("assets/x.png")).toBe(false);
    expect(isExternalRef("./assets/x.png")).toBe(false);
    expect(isExternalRef("../shared/x.png")).toBe(false);
    expect(isExternalRef("x.png")).toBe(false);
  });
});

describe("rewriteImageRefs", () => {
  it("maps a vault path to a URL for rendering, leaving the rest alone", () => {
    const md = "# T\n\n![d](assets/d.png)\n\ntext\n";
    const out = rewriteImageRefs(md, (t) => `https://cdn/${t}`);
    expect(out).toBe("# T\n\n![d](https://cdn/assets/d.png)\n\ntext\n");
  });

  it("returning null leaves that ref untouched", () => {
    const md = "![a](assets/a.png) ![b](https://x/b.png)";
    const out = rewriteImageRefs(md, (t) => (isExternalRef(t) ? null : "LOCAL"));
    expect(out).toBe("![a](LOCAL) ![b](https://x/b.png)");
  });

  it("preserves the alt text and the title", () => {
    const out = rewriteImageRefs('![my alt](a.png "the title")', () => "b.png");
    expect(out).toBe('![my alt](b.png "the title")');
  });

  it("never rewrites inside code", () => {
    const md = "```\n![x](a.png)\n```\n![y](a.png)";
    expect(rewriteImageRefs(md, () => "Z")).toBe("```\n![x](a.png)\n```\n![y](Z)");
  });

  it("round-trips: URL back to the vault path is the identity", () => {
    const md = "![d](assets/d.png)\n";
    const rendered = rewriteImageRefs(md, (t) => `https://cdn/${t}`);
    const stored = rewriteImageRefs(rendered, (t) => t.replace("https://cdn/", ""));
    expect(stored).toBe(md);
  });

  it("handles several refs on one line without shifting positions", () => {
    const out = rewriteImageRefs("![a](1.png)![b](2.png)![c](3.png)", (t) => `x/${t}`);
    expect(out).toBe("![a](x/1.png)![b](x/2.png)![c](x/3.png)");
  });

  it("wraps a spaced target in <> so it stays a real image on the way to storage", () => {
    const out = rewriteImageRefs("![shot](https://cdn/x?token=T)", () => "assets/a b.png");
    expect(out).toBe("![shot](<assets/a b.png>)");
    // ...and reading it straight back finds the same target.
    expect(imageRefs(out).map((r) => r.target)).toEqual(["assets/a b.png"]);
  });
});

describe("assetPathFor", () => {
  it("puts an asset in the assets folder, sanitized", () => {
    expect(assetPathFor("My Diagram.png", [])).toBe("assets/My Diagram.png");
    expect(assetPathFor("we:ird*.png", [])).toBe("assets/we-ird-.png");
  });

  it("de-dupes a name that's taken, keeping the extension", () => {
    expect(assetPathFor("a.png", ["assets/a.png"])).toBe("assets/a-1.png");
    expect(assetPathFor("a.png", ["assets/a.png", "assets/a-1.png"])).toBe("assets/a-2.png");
  });

  it("falls back for a nameless or extensionless file", () => {
    expect(assetPathFor("", [])).toBe("assets/image");
    expect(assetPathFor("screenshot", [])).toBe("assets/screenshot");
  });
});

// The boundary. Y.Text stores `assets/d.png` — always, that's the truth contract —
// but a browser can't render that: it would resolve against the page URL and 404.
// So a lens sits at the derive/serialize seam: storage→editor swaps paths for
// URLs, editor→storage swaps them back. Y.Text never sees a URL; the editor never
// sees a path. Both directions are pure text, which is why they're testable here
// rather than only through a live editor.
describe("MediaRegistry / lens", () => {
  const links = [
    { path: "assets/d.png", url: "https://sb/storage/v1/object/sign/vault-assets/v1/abc?token=T1" },
    { path: "assets/e.jpg", url: "https://sb/storage/v1/object/sign/vault-assets/v1/def?token=T2" },
  ];

  it("resolves a stored path to a URL for the editor", () => {
    const r = new MediaRegistry(links);
    expect(r.lens().toEditor("![d](assets/d.png)")).toBe(`![d](${links[0].url})`);
  });

  it("puts the path back when the editor hands markdown over", () => {
    const r = new MediaRegistry(links);
    expect(r.lens().toStorage(`![d](${links[0].url})`)).toBe("![d](assets/d.png)");
  });

  // The signing token changes every time the URL is minted, so a URL seen a
  // moment later is a different string for the same object. Matching on the whole
  // URL would silently fail to map it back — and the path would be lost.
  it("maps a URL back even after the signing token has changed", () => {
    const r = new MediaRegistry(links);
    const later = "https://sb/storage/v1/object/sign/vault-assets/v1/abc?token=DIFFERENT";
    expect(r.lens().toStorage(`![d](${later})`)).toBe("![d](assets/d.png)");
  });

  it("round-trips: storage → editor → storage is the identity", () => {
    const r = new MediaRegistry(links);
    const stored = "# T\n\n![d](assets/d.png)\n\n![e](assets/e.jpg)\n";
    const shown = r.lens().toEditor(stored);
    expect(shown).not.toContain("assets/d.png"); // the editor really sees URLs
    expect(r.lens().toStorage(shown)).toBe(stored);
  });

  // The exact bug that made pasted screenshots show as links: a spaced asset path
  // must resolve to a URL for the editor, and map back (wrapped in <>) for storage.
  it("resolves and round-trips a spaced asset path (the pasted-screenshot case)", () => {
    const spaced = {
      path: "assets/Screenshot 2026-07-21 at 12.13.52 PM.png",
      url: "https://sb/storage/v1/object/sign/vault-assets/v1/shot?token=T",
    };
    const r = new MediaRegistry([spaced]);
    const stored = `![shot](${spaced.path})`;
    const shown = r.lens().toEditor(stored);
    expect(shown).toBe(`![shot](${spaced.url})`); // a real image URL, not raw text
    // Back to storage as a valid <>-wrapped path, which still renders next time.
    const restored = r.lens().toStorage(shown);
    expect(restored).toBe(`![shot](<${spaced.path}>)`);
    expect(r.lens().toEditor(restored)).toBe(`![shot](${spaced.url})`);
  });

  it("leaves an image the user linked from the web alone, in both directions", () => {
    const r = new MediaRegistry(links);
    const md = "![web](https://example.com/x.png)";
    expect(r.lens().toEditor(md)).toBe(md);
    expect(r.lens().toStorage(md)).toBe(md);
  });

  it("leaves an unknown vault path alone rather than blanking it", () => {
    const r = new MediaRegistry(links);
    // An asset that exists on disk but hasn't been indexed yet: keep the path, so
    // the reference survives to be resolved later.
    expect(r.lens().toEditor("![x](assets/not-yet.png)")).toBe("![x](assets/not-yet.png)");
  });

  // A fresh upload has to be resolvable immediately — the user pastes an image and
  // sees it, without a refetch of the whole asset list.
  it("resolves an asset added after construction", () => {
    const r = new MediaRegistry([]);
    r.add({ path: "assets/new.png", url: "https://sb/o/sign/vault-assets/v1/zzz?token=T" });
    expect(r.lens().toEditor("![n](assets/new.png)")).toContain("zzz?token=T");
    expect(r.lens().toStorage("![n](https://sb/o/sign/vault-assets/v1/zzz?token=T)")).toBe(
      "![n](assets/new.png)"
    );
  });
});

// Deleting a vault cascades its asset ROWS away and never tells Storage, so the
// objects leak. No FK reaches a blob store, and Supabase refuses direct SQL
// deletes on storage tables — a sweep is the only answer, as it is for every
// system with an external blob store.
//
// The danger is the sweep itself. putAsset uploads bytes and THEN writes the row
// (deliberately: an object with no row is garbage, a row with no object is a
// broken image). In between, an object legitimately has no row — and deleting it
// there would destroy a live image the instant someone pasted it. Hence the grace
// period: an orphan must have been unclaimed for a while before we believe it.
describe("selectOrphans — what the sweep may delete", () => {
  const HOUR = 60 * 60 * 1000;
  const now = Date.parse("2026-07-16T12:00:00Z");
  const obj = (name: string, agoMs: number) => ({
    name,
    created_at: new Date(now - agoMs).toISOString(),
  });

  it("finds an object no row claims", () => {
    expect(selectOrphans([obj("abc", 48 * HOUR)], new Set(), now, 24 * HOUR)).toEqual(["abc"]);
  });

  it("leaves a claimed object alone", () => {
    expect(selectOrphans([obj("abc", 48 * HOUR)], new Set(["abc"]), now, 24 * HOUR)).toEqual([]);
  });

  // THE RACE. putAsset's row lands moments after the object; sweeping in that
  // window deletes the picture someone just pasted.
  it("never touches an object young enough to be mid-upload", () => {
    expect(selectOrphans([obj("fresh", 5000)], new Set(), now, 24 * HOUR)).toEqual([]);
  });

  it("sweeps only what has been unclaimed past the grace period", () => {
    const objects = [obj("old", 48 * HOUR), obj("recent", 1 * HOUR)];
    expect(selectOrphans(objects, new Set(), now, 24 * HOUR)).toEqual(["old"]);
  });

  it("treats an unreadable timestamp as too young to touch", () => {
    // Never delete on the basis of a date we couldn't parse.
    const weird = [{ name: "x", created_at: "not-a-date" }];
    expect(selectOrphans(weird, new Set(), now, 24 * HOUR)).toEqual([]);
  });

  it("handles an empty bucket and an empty claim set", () => {
    expect(selectOrphans([], new Set(), now, HOUR)).toEqual([]);
  });
});
