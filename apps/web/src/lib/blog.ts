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

/** What a post is: a change to the product, a desktop release, or a note on
 * something around it, such as a look at the tools nearby. */
export type BlogKind = "Update" | "Release" | "Note";

export interface BlogPost {
  slug: string;
  kind: BlogKind;
  title: string;
  /** The day it was published, as YYYY-MM-DD. */
  date: string;
  /** One or two sentences, shown in the list and as the page description. */
  summary: string;
  /** A video shown under the lead, and its poster, which also becomes the share image. */
  video?: BlogVideo;
}

/** A post's video: files under public/, served from these paths. */
export interface BlogVideo {
  mp4: string;
  webm?: string;
  /** A still of the video (JPEG), shown before it plays. */
  poster: string;
  width: number;
  height: number;
  /** What the video shows, for anyone who can't watch it. */
  label: string;
}

export const BLOG_POSTS: BlogPost[] = [
  {
    slug: "connect-claude-connector",
    kind: "Update",
    title: "Connect Markbase to Claude in a minute",
    date: "2026-11-24",
    summary:
      "Find Markbase in Claude's connectors, sign in or sign up on the way, and choose what Claude may do. Then ask Claude to get you started, write up a chat, comment on a document and share it.",
    video: {
      mp4: "/blog/connect-claude-connector.mp4",
      webm: "/blog/connect-claude-connector.webm",
      poster: "/blog/connect-claude-connector.jpg",
      width: 1920,
      height: 1080,
      label:
        "Markbase is connected from Claude's connectors: a new account is made during sign-in and Claude is given Owner access. Claude then shows a getting-started card, writes the chat up as a document, comments on another and makes a share link.",
    },
  },
  {
    slug: "markbase-in-claude",
    kind: "Update",
    title: "Your Markbase documents, right in the Claude chat",
    date: "2026-11-23",
    summary:
      "Ask Claude for a Markbase document and it now shows up in the conversation as it reads, not as raw text. Press Open full page to read the whole thing beside the chat.",
    video: {
      mp4: "/blog/markbase-in-claude.mp4",
      webm: "/blog/markbase-in-claude.webm",
      poster: "/blog/markbase-in-claude.jpg",
      width: 1920,
      height: 1080,
      label:
        "Claude is asked for a Markbase document. It appears as a card in the chat, and Open full page shows the whole document beside the conversation.",
    },
  },
  {
    slug: "hosted-mcp-server",
    kind: "Update",
    title: "Connect any agent to Markbase with one address",
    date: "2026-11-20",
    summary:
      "Markbase's MCP server now runs at markbase.so/mcp. It is in Claude's connectors directory, and works with Claude Code, Codex, Cursor, VS Code, opencode, Pi and OpenClaw: sign in once and choose what the agent may do.",
  },
  {
    slug: "see-what-agents-did",
    kind: "Update",
    title: "See which agents read a doc, and which lines they wrote",
    date: "2026-11-19",
    summary:
      "Each document's Analytics panel now shows which agents read it and for whom, and who wrote each line. Useful on call, in investigations and when you review a design.",
  },
  {
    slug: "ai-sre-tools-late-2026",
    kind: "Note",
    title: "AI SRE tools in late 2026: who keeps what your agent learned",
    date: "2026-11-17",
    summary:
      "The AI SRE tools of late 2026, grouped like the r/sre list, with one question most comparisons skip: after the incident, where does what the agent learned live, and what leaves with you if you cancel.",
  },
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

/** The site's address, for the absolute URLs a feed and structured data need. */
export function siteUrl(): string {
  return process.env.APP_URL ?? "https://markbase.so";
}

/** The path of the blog list, or of one post. */
export function blogPath(slug?: string): string {
  return slug ? `/blog/${slug}` : "/blog";
}

/**
 * A post as one markdown document — its title, date and summary above the
 * body. Served at /blog/<slug>.md for readers that want the source, AI
 * crawlers among them.
 */
export function blogMarkdownDocument(post: BlogPost, markdown: string): string {
  return `# ${post.title}\n\n_${blogDate(post.date)} · ${post.kind}_\n\n${markdown.trim()}\n`;
}

/** The image a post is shown with where one is wanted: search results, share cards. */
export const BLOG_IMAGE = { path: "/markbase-logo.png", width: 1024, height: 1024 };

/** Markbase as schema.org sees it: the author and publisher of every post. */
export function blogOrganization() {
  const base = siteUrl();
  return {
    "@type": "Organization",
    name: "Markbase",
    url: base,
    logo: { "@type": "ImageObject", url: `${base}${BLOG_IMAGE.path}` },
  };
}

/**
 * One post as a schema.org BlogPosting — used on the post's own page and for
 * each entry of the list's Blog, so both carry the same fields (Google's
 * article result wants an image and an author on every one).
 */
export function blogPostingData(post: BlogPost) {
  const base = siteUrl();
  const url = `${base}${blogPath(post.slug)}`;
  const markbase = blogOrganization();
  return {
    "@type": "BlogPosting",
    headline: post.title,
    description: post.summary,
    image: [`${base}${post.video?.poster ?? BLOG_IMAGE.path}`],
    datePublished: `${post.date}T00:00:00Z`,
    dateModified: `${post.date}T00:00:00Z`,
    articleSection: post.kind,
    inLanguage: "en",
    author: markbase,
    publisher: markbase,
    url,
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
  };
}
