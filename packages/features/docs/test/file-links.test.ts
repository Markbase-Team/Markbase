import { describe, it, expect } from "vitest";
import { markdownToDoc, docToMarkdown } from "../src/logic/markdown";

// A vault holds notes ABOUT documents that live elsewhere — a passport scan in
// iCloud Drive, a PDF in Downloads. markdown-it's default validateLink lumps
// `file:` in with `javascript:` and refuses it, so a 25-entry checklist of them
// rendered as literal markdown source: not merely unclickable, never a link.

function hrefIn(markdown: string): string | null {
  const json = JSON.stringify(markdownToDoc(markdown).toJSON());
  return JSON.parse(json).content
    ?.flatMap((n: { content?: unknown[] }) => n.content ?? [])
    .flatMap((n: { marks?: { type: string; attrs?: { href?: string } }[] }) => n.marks ?? [])
    .find((m: { type: string }) => m.type === "link")?.attrs?.href ?? null;
}

describe("links to files on this machine", () => {
  it("makes a link out of a file: URL", () => {
    expect(hrefIn("[passport.pdf](file:///Users/j/passport.pdf)\n")).toBe(
      "file:///Users/j/passport.pdf"
    );
  });

  it("keeps a percent-encoded path intact — these come from real Finder paths", () => {
    const url = "file:///Users/j/Me%20and%20Family/%E7%AD%BE%E8%AF%81/a.pdf";
    expect(hrefIn(`[a.pdf](${url})\n`)).toBe(url);
  });

  it("round-trips back to the same markdown", () => {
    // docToMarkdown does not emit a trailing newline; compare the content.
    const md = "[passport.pdf](file:///Users/j/passport.pdf)";
    expect(docToMarkdown(markdownToDoc(md + "\n")).trim()).toBe(md);
  });

  it("still makes ordinary web links", () => {
    expect(hrefIn("[site](https://example.com)\n")).toBe("https://example.com");
  });
});

describe("protocols that execute are still refused", () => {
  it("javascript:", () => {
    expect(hrefIn("[x](javascript:alert(1))\n")).toBeNull();
  });

  it("vbscript:", () => {
    expect(hrefIn("[x](vbscript:msgbox)\n")).toBeNull();
  });

  it("data: that is not an image", () => {
    expect(hrefIn("[x](data:text/html;base64,PHNjcmlwdD4=)\n")).toBeNull();
  });

  it("but an inline data: image is fine", () => {
    const url = "data:image/png;base64,iVBORw0KGgo=";
    expect(hrefIn(`[x](${url})\n`)).toBe(url);
  });
});
