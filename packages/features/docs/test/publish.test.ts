import { describe, it, expect } from "vitest";
import { markdownToHtml, excerpt } from "../src/logic/html";
import { publicSlug } from "../src/server/publish";

// The publish-to-web layer renders a doc to a public, SEO/GEO-friendly page:
// markdown -> HTML for the body, a plain-text excerpt for <meta>, and a stable
// public slug for the URL. These are the pieces the /p/[slug] page depends on.

describe("markdownToHtml", () => {
  it("renders GFM tables", () => {
    const html = markdownToHtml("| a | b |\n|---|---|\n| 1 | 2 |");
    expect(html).toContain("<table>");
    expect(html).toContain("<td>1</td>");
  });

  it("renders ==highlight== as <mark>", () => {
    expect(markdownToHtml("==hi==")).toContain("<mark>hi</mark>");
  });

  it("auto-links bare URLs", () => {
    expect(markdownToHtml("see https://markbase.so now")).toContain(
      '<a href="https://markbase.so"'
    );
  });

  it("escapes raw HTML instead of passing it through (html:false)", () => {
    const html = markdownToHtml("<script>alert(1)</script>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("handles empty / nullish input", () => {
    expect(markdownToHtml("")).toBe("");
    // @ts-expect-error — defends the runtime guard against undefined
    expect(markdownToHtml(undefined)).toBe("");
  });
});

describe("excerpt", () => {
  it("strips markdown punctuation and collapses whitespace", () => {
    expect(excerpt("# Title\n\nHello **world**")).toBe("Title Hello world");
  });

  it("keeps link text but drops the URL", () => {
    expect(excerpt("Read [the docs](https://x.co/y) here")).toBe(
      "Read the docs here"
    );
  });

  it("removes images and fenced code blocks", () => {
    expect(excerpt("![alt](a.png) hi")).toBe("hi");
    expect(excerpt("```\ncode\n```\ntext")).toBe("text");
  });

  it("truncates to the max length with an ellipsis", () => {
    const out = excerpt("word ".repeat(100), 20);
    expect(out.length).toBeLessThanOrEqual(20);
    expect(out.endsWith("…")).toBe(true);
  });

  it("returns the whole string when under the limit", () => {
    expect(excerpt("short and sweet")).toBe("short and sweet");
  });
});

describe("publicSlug", () => {
  const id = "abcdef12-3456-7890-abcd-ef1234567890";

  it("kebab-cases the title and appends an 8-char id suffix", () => {
    expect(publicSlug("Hello World!", id)).toBe("hello-world-abcdef12");
  });

  it("strips accents and emoji and collapses whitespace to single dashes", () => {
    expect(publicSlug("Café  Déjà Vu 🎉", id)).toBe("cafe-deja-vu-abcdef12");
  });

  it("drops underscores/punctuation entirely (not converted to dashes)", () => {
    expect(publicSlug("a__b.c", id)).toBe("abc-abcdef12");
  });

  it("falls back to 'doc' when the title has no sluggable characters", () => {
    expect(publicSlug("👋🎉", id)).toBe("doc-abcdef12");
  });

  it("is stable for the same title + id", () => {
    expect(publicSlug("Overview", id)).toBe(publicSlug("Overview", id));
  });
});
