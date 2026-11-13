import { describe, expect, it } from "vitest";
import { headingSlug } from "@markbase/ui/markdown";
import { DOCS_MARKDOWN } from "@/generated/docs-pages";
import { DOCS_MOVED, DOCS_NAV, docsDescription, docsOutline, docsPage, docsPages } from "@/lib/docs-nav";

// The docs' sidebar and its pages must agree: every entry has a markdown file,
// every file has an entry, and Previous / Next walk the sidebar's order.
describe("docs navigation", () => {
  it("has a page for every sidebar entry and an entry for every page", () => {
    const listed = docsPages().map((p) => p.slug);
    expect(new Set(listed).size).toBe(listed.length);
    expect([...listed].sort()).toEqual(Object.keys(DOCS_MARKDOWN).sort());
  });

  it("walks the sidebar in order", () => {
    const all = docsPages();
    const first = docsPage(all[0].slug)!;
    const last = docsPage(all[all.length - 1].slug)!;
    expect(first.previous).toBeNull();
    expect(first.next?.slug).toBe(all[1].slug);
    expect(last.next).toBeNull();
    expect(last.previous?.slug).toBe(all[all.length - 2].slug);
    expect(docsPage("no-such-page")).toBeNull();
  });

  it("starts with Get started, then Use cases, Features and Deployment", () => {
    expect(DOCS_NAV.map((s) => s.title)).toEqual(["Get started", "Use cases", "Features", "Deployment"]);
    expect(DOCS_NAV[0].pages.map((p) => p.title)).toEqual(["Introduction", "Quick start"]);
  });

  it("outlines h2 and h3, skipping code fences, with the renderer's ids", () => {
    const md = "# Title\n\n## Why a folder\n\n```bash\n## not a heading\n```\n\n### The `.markbaseignore` file\n";
    expect(docsOutline(md)).toEqual([
      { id: "why-a-folder", text: "Why a folder", depth: 2 },
      { id: headingSlug("The .markbaseignore file"), text: "The .markbaseignore file", depth: 3 },
    ]);
  });

  it("links internal pages that exist", () => {
    const slugs = new Set(docsPages().map((p) => p.slug));
    for (const [slug, md] of Object.entries(DOCS_MARKDOWN)) {
      for (const m of md.matchAll(/\]\(\/docs\/([a-z0-9-]+)/g)) {
        expect(slugs.has(m[1]), `${slug}.md links to /docs/${m[1]}`).toBe(true);
      }
    }
  });

  it("sends every moved page to a page that exists, and never shadows a live one", () => {
    const slugs = new Set(docsPages().map((p) => p.slug));
    for (const [old, to] of Object.entries(DOCS_MOVED)) {
      expect(slugs.has(old), `${old} is still a page`).toBe(false);
      const target = /^\/docs\/([a-z0-9-]+)/.exec(to)?.[1];
      expect(target && slugs.has(target), `${old} → ${to}`).toBe(true);
    }
  });
});

describe("docsDescription", () => {
  it("is the first paragraph as plain text", () => {
    expect(docsDescription("# Title\n\nA [linked](/x) `code` **bold** line.\n\n## Next\n\nMore.", 160, 10)).toBe(
      "A linked code bold line.",
    );
  });

  it("adds the next paragraph when the first is short", () => {
    expect(docsDescription("# T\n\nShort one.\n\n## Section\n\nThe rest of it.", 160, 20)).toBe(
      "Short one. The rest of it.",
    );
  });

  it("skips lists and code to find the first paragraph", () => {
    expect(docsDescription("# T\n\n```bash\nnpm i\n```\n\n- item\n\nThe text.")).toBe("The text.");
  });

  it("cuts long text at a word, under the limit", () => {
    const d = docsDescription(`# T\n\n${"word ".repeat(60)}`, 50);
    expect(d.length).toBeLessThanOrEqual(50);
    expect(d.endsWith("word…")).toBe(true);
  });

  it("gives every docs page its own description", () => {
    const all = docsPages().map((p) => docsDescription(docsPage(p.slug)!.markdown));
    expect(all.every((d) => d.length >= 50 && d.length <= 160)).toBe(true);
    expect(new Set(all).size).toBe(all.length);
  });
});
