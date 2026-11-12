import { headingSlug } from "@markbase/ui/markdown";
import { DOCS_MARKDOWN } from "@/generated/docs-pages";

// The docs' table of contents: sections in sidebar order, each a list of
// pages. A page's slug is its file name in apps/web/content/docs (`vaults` is
// vaults.md) and its URL (/docs/vaults). The order here is the order the
// sidebar shows and the order Previous / Next walk.

export interface DocsPage {
  slug: string;
  title: string;
}

export interface DocsSection {
  title: string;
  pages: DocsPage[];
}

export const DOCS_NAV: DocsSection[] = [
  {
    title: "Get started",
    pages: [
      { slug: "introduction", title: "Introduction" },
      { slug: "quick-start", title: "Quick start" },
    ],
  },
  {
    title: "Use cases",
    pages: [
      { slug: "docs-next-to-code", title: "Docs next to your code" },
      { slug: "keep-clients-in-the-loop", title: "Keep clients in the loop" },
      { slug: "on-call", title: "On-call with agents" },
    ],
  },
  {
    title: "Features",
    pages: [
      { slug: "vaults", title: "Vaults" },
      { slug: "sharing", title: "Sharing" },
      { slug: "agents", title: "Agents" },
      { slug: "desktop-app", title: "Desktop app" },
    ],
  },
  {
    title: "Deployment",
    pages: [
      { slug: "self-hosting", title: "Self-hosting" },
      { slug: "deploy-on-vercel", title: "Deploy on Vercel" },
      { slug: "invite-your-team", title: "Invite your team" },
    ],
  },
];

export const FIRST_DOCS_PAGE = DOCS_NAV[0].pages[0].slug;

/**
 * Pages that moved, so links already shared keep working: the old slug and
 * where it lives now.
 */
export const DOCS_MOVED: Record<string, string> = {
  "desktop-and-cli": "/docs/desktop-app",
  formats: "/docs/vaults#formats",
  "publish-and-share": "/docs/keep-clients-in-the-loop",
  "specs-and-handoffs": "/docs/docs-next-to-code#specs-and-handoffs",
};

/** Every page, in sidebar order, with the section it sits in. */
export function docsPages(): (DocsPage & { section: string })[] {
  return DOCS_NAV.flatMap((s) => s.pages.map((p) => ({ ...p, section: s.title })));
}

/** A page's markdown and its place in the order, or null for an unknown slug. */
export function docsPage(slug: string): {
  page: DocsPage & { section: string };
  markdown: string;
  previous: (DocsPage & { section: string }) | null;
  next: (DocsPage & { section: string }) | null;
} | null {
  const all = docsPages();
  const i = all.findIndex((p) => p.slug === slug);
  const markdown = DOCS_MARKDOWN[slug];
  if (i < 0 || markdown === undefined) return null;
  return { page: all[i], markdown, previous: all[i - 1] ?? null, next: all[i + 1] ?? null };
}

/** One heading in a page's outline. */
export interface OutlineItem {
  id: string;
  text: string;
  depth: 2 | 3;
}

/**
 * The page's h2 and h3 headings, for the outline beside it. Ids come from the
 * same `headingSlug` the renderer uses, so every entry links to its heading.
 */
export function docsOutline(markdown: string): OutlineItem[] {
  const items: OutlineItem[] = [];
  let fenced = false;
  for (const line of markdown.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    if (fenced) continue;
    const m = /^(#{2,3})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!m) continue;
    const text = m[2].replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[`*_]/g, "");
    items.push({ id: headingSlug(text), text, depth: m[1].length === 2 ? 2 : 3 });
  }
  return items;
}
