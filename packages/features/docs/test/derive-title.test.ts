import { describe, it, expect } from "vitest";
import { deriveTitle, isUntitled, leadingH1, splitFrontmatter } from "../src/logic/markdown";

// A document's title renames its FILE (path-follows-title), so getting this
// wrong is destructive, not cosmetic. These cases are the ones that actually
// lost files: two Hexo posts were retitled to a section heading of their own
// body, their originals moved to .trash, and both landed on `TL;DR.md`.

const HEXO_POST = `---
title: 'Prometheus Behind NAT: Scraping Without Open Ports'
date: '2026-08-25T16:00:00.000Z'
tags:
  - Prometheus
---

Some intro prose that is not a heading.

## The setup

A pull-based monitor reaches a machine with no public IP.

## TL;DR

The tunnel is a phone line, not a mailbox.
`;

describe("deriveTitle", () => {
  it("prefers the title the document declares in frontmatter", () => {
    expect(deriveTitle(HEXO_POST)).toBe(
      "Prometheus Behind NAT: Scraping Without Open Ports"
    );
  });

  it("never takes a section heading from the body as the title", () => {
    // The regression: `## The setup` sits at line 23 and used to win.
    expect(deriveTitle(HEXO_POST)).not.toBe("The setup");
    expect(deriveTitle(HEXO_POST)).not.toBe("TL;DR");
  });

  it("ignores an h2 even with no frontmatter at all", () => {
    expect(deriveTitle("Intro paragraph.\n\n## TL;DR\n\nbody\n")).toBeNull();
  });

  it("ignores an h1 that is not the opening block", () => {
    // Content came first, so this heading is a section of the body.
    expect(deriveTitle("Some prose.\n\n# Later Heading\n")).toBeNull();
  });

  it("takes an opening h1 — a Markbase-native doc names itself that way", () => {
    expect(deriveTitle("# My Document\n\nbody text\n")).toBe("My Document");
  });

  it("allows an opening h1 through blank lines", () => {
    expect(deriveTitle("\n\n   \n# Spaced Out\n\nbody\n")).toBe("Spaced Out");
  });

  it("falls back to the h1 when frontmatter carries no title", () => {
    expect(deriveTitle("---\ndate: 2026-01-01\n---\n\n# Real Title\n")).toBe(
      "Real Title"
    );
  });

  it("ignores a blank or non-string frontmatter title", () => {
    expect(deriveTitle("---\ntitle: '   '\n---\n\n# Fallback\n")).toBe("Fallback");
    expect(deriveTitle("---\ntitle: 42\n---\n\n# Fallback\n")).toBe("Fallback");
  });

  it("returns null when there is no title — the caller uses the filename", () => {
    expect(deriveTitle("just prose, no headings\n")).toBeNull();
    expect(deriveTitle("")).toBeNull();
  });

  it("does not treat an empty h1 as a title", () => {
    expect(deriveTitle("#\n\nbody\n")).toBeNull();
  });
});

describe("splitFrontmatter", () => {
  it("separates a leading YAML block from the body", () => {
    const { frontmatter, body } = splitFrontmatter(HEXO_POST);
    expect(frontmatter?.title).toBe(
      "Prometheus Behind NAT: Scraping Without Open Ports"
    );
    expect(body.startsWith("\nSome intro prose")).toBe(true);
  });

  it("keeps malformed YAML in the body rather than losing it", () => {
    const bad = "---\ntitle: [unclosed\n---\n\nbody\n";
    const { frontmatter, body } = splitFrontmatter(bad);
    expect(frontmatter).toBeNull();
    expect(body).toBe(bad);
  });

  it("leaves a document with no frontmatter untouched", () => {
    const { frontmatter, body } = splitFrontmatter("# Title\n\nbody\n");
    expect(frontmatter).toBeNull();
    expect(body).toBe("# Title\n\nbody\n");
  });

  it("does not treat a --- rule mid-document as frontmatter", () => {
    const doc = "# Title\n\n---\n\nbody\n";
    expect(splitFrontmatter(doc).frontmatter).toBeNull();
  });
});

describe("leadingH1", () => {
  it("accepts up to three spaces of indent, per CommonMark", () => {
    expect(leadingH1("   # Indented\n")).toBe("Indented");
    expect(leadingH1("    # Code block, not a heading\n")).toBeNull();
  });

  it("requires level 1", () => {
    expect(leadingH1("## Two\n")).toBeNull();
    expect(leadingH1("###### Six\n")).toBeNull();
  });

  it("requires a space after the hash", () => {
    expect(leadingH1("#NoSpace\n")).toBeNull();
  });
});

// The stronger rule: automatic titling is for documents that have no title. Once a
// document is named, only an explicit rename changes it — because the file path
// follows the title, so "re-derive the title" means "rename the user's file".
describe("isUntitled — may we name this automatically?", () => {
  it("yes for a document that has never been named", () => {
    expect(isUntitled("")).toBe(true);
    expect(isUntitled("   ")).toBe(true);
    expect(isUntitled(null)).toBe(true);
    expect(isUntitled(undefined)).toBe(true);
  });

  it("yes for the placeholder createDocument assigns", () => {
    // createDocument defaults to "Untitled"; that is a placeholder, not a name.
    expect(isUntitled("Untitled")).toBe(true);
    expect(isUntitled("untitled")).toBe(true);
    expect(isUntitled("  UNTITLED  ")).toBe(true);
  });

  it("no for a name that came from a file — the case that lost two posts", () => {
    expect(isUntitled("speculative-decoding-and-mtp-zh")).toBe(false);
    expect(isUntitled("prometheus-behind-nat-reverse-tunnel")).toBe(false);
  });

  it("no for a name a person chose, however odd", () => {
    expect(isUntitled("TL;DR")).toBe(false);
    expect(isUntitled("Untitled Symphony")).toBe(false);
    expect(isUntitled("0")).toBe(false);
  });
});
