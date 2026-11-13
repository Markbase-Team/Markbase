import { BLOG_MARKDOWN } from "@/generated/blog-posts";

// The blog: short notes on what changed. A post is an entry here plus its
// body, apps/web/content/blog/<slug>.md (the body starts below the title —
// the title and date are drawn from this entry). Its URL is /blog/<slug>.
// Add a new post at the top: the list is shown in this order, newest first.
//
// How a body is laid out (see blogSections and app/blog/[slug]/page.tsx):
//   - the text before the first `## ` heading is the lead, set large;
//   - each `## ` heading starts a section;
//   - a bulleted list is set as titled paragraphs — start each bullet with
//     a bold title (`- **It asks once.** After you…`);
//   - a section with a numbered list becomes the dark "steps" block: the
//     text before the list beside its heading, the steps numbered in lime.

/** What a post is: a change to the product, or a desktop release. */
export type BlogKind = "Update" | "Release";

export interface BlogPost {
  slug: string;
  kind: BlogKind;
  title: string;
  /** The day it was published, as YYYY-MM-DD. */
  date: string;
  /** One or two sentences, shown in the list and as the page description. */
  summary: string;
}

export const BLOG_POSTS: BlogPost[] = [
  {
    slug: "default-markdown-app",
    kind: "Update",
    title: "Markbase can be your default markdown app",
    date: "2026-11-12",
    summary:
      "The Mac app can now open .md files when you double-click them in Finder, and asks once whether to be the default.",
  },
];

/** A post and its markdown body, or null when there is no such post. */
export function blogPost(slug: string): { post: BlogPost; markdown: string } | null {
  const post = BLOG_POSTS.find((p) => p.slug === slug);
  const markdown = BLOG_MARKDOWN[slug];
  return post && markdown !== undefined ? { post, markdown } : null;
}

/** "November 12, 2026" — the same on the server and in every time zone. */
export function blogDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** One month of the list: its name, its year, and its posts in list order. */
export interface BlogMonth {
  /** "2026-11" — unique per month, for keys. */
  key: string;
  /** "November" */
  month: string;
  /** "2026" */
  year: string;
  posts: BlogPost[];
}

/** Posts in the order given, grouped by the month they were published. */
export function groupByMonth(posts: BlogPost[]): BlogMonth[] {
  const groups: BlogMonth[] = [];
  for (const post of posts) {
    const key = post.date.slice(0, 7);
    const last = groups[groups.length - 1];
    if (last && last.key === key) {
      last.posts.push(post);
      continue;
    }
    const day = new Date(`${post.date}T00:00:00Z`);
    groups.push({
      key,
      month: day.toLocaleDateString("en-US", { month: "long", timeZone: "UTC" }),
      year: day.toLocaleDateString("en-US", { year: "numeric", timeZone: "UTC" }),
      posts: [post],
    });
  }
  return groups;
}

/** "12" — the day of the month a post was published. */
export function blogDay(date: string): string {
  return String(Number(date.slice(8, 10)));
}

/** One `## ` section of a post's body. */
export interface BlogSection {
  title: string;
  /** The section's markdown — for a steps section, only what precedes the list. */
  body: string;
  /** The numbered list of a steps section, as markdown; null for any other. */
  steps: string | null;
}

/** A post's body, split into its lead and its `## ` sections. */
export function blogSections(markdown: string): { lead: string; sections: BlogSection[] } {
  const [lead, ...rest] = markdown.split(/^## +/m);
  const sections = rest.map((chunk): BlogSection => {
    const newline = chunk.indexOf("\n");
    const title = (newline === -1 ? chunk : chunk.slice(0, newline)).trim();
    const body = newline === -1 ? "" : chunk.slice(newline + 1).trim();
    const list = body.search(/^1\. /m);
    return list === -1
      ? { title, body, steps: null }
      : { title, body: body.slice(0, list).trim(), steps: body.slice(list).trim() };
  });
  return { lead: lead.trim(), sections };
}
