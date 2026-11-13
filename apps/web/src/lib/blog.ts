import { BLOG_MARKDOWN } from "@/generated/blog-posts";

// The blog: short notes on what changed. A post is an entry here plus its
// body, apps/web/content/blog/<slug>.md (the body starts below the title —
// the title and date are drawn from this entry). Its URL is /blog/<slug>.
// Add a new post at the top: the list is shown in this order, newest first.

export interface BlogPost {
  slug: string;
  title: string;
  /** The day it was published, as YYYY-MM-DD. */
  date: string;
  /** One or two sentences, shown in the list and as the page description. */
  summary: string;
}

export const BLOG_POSTS: BlogPost[] = [
  {
    slug: "default-markdown-app",
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

/** "November 2026" — the heading a post is listed under. */
export function blogMonth(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    timeZone: "UTC",
  });
}

/** The posts in list order, grouped by the month they were published. */
export function blogPostsByMonth(): { month: string; posts: BlogPost[] }[] {
  const groups: { month: string; posts: BlogPost[] }[] = [];
  for (const post of BLOG_POSTS) {
    const month = blogMonth(post.date);
    const last = groups[groups.length - 1];
    if (last && last.month === month) last.posts.push(post);
    else groups.push({ month, posts: [post] });
  }
  return groups;
}
