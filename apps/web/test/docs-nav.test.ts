import { describe, expect, it } from "vitest";
import { headingSlug } from "@markbase/ui/markdown";
import { DOCS_MARKDOWN } from "@/generated/docs-pages";
import { DOCS_NAV, docsOutline, docsPage, docsPages } from "@/lib/docs-nav";

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
});
