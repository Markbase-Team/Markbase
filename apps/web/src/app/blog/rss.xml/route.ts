import { BLOG_POSTS, blogPath, siteUrl } from "@/lib/blog";

// GET /blog/rss.xml — the blog as an RSS 2.0 feed, newest first.

function xml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function GET() {
  const base = siteUrl();
  const items = BLOG_POSTS.map((post) => {
    const url = `${base}${blogPath(post.slug)}`;
    return [
      "    <item>",
      `      <title>${xml(post.title)}</title>`,
      `      <link>${url}</link>`,
      `      <guid isPermaLink="true">${url}</guid>`,
      `      <pubDate>${new Date(`${post.date}T00:00:00Z`).toUTCString()}</pubDate>`,
      `      <category>${xml(post.kind)}</category>`,
      `      <description>${xml(post.summary)}</description>`,
      "    </item>",
    ].join("\n");
  });
  const feed = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    "  <channel>",
    "    <title>Markbase blog</title>",
    `    <link>${base}${blogPath()}</link>`,
    "    <description>What changed in Markbase, in short notes.</description>",
    "    <language>en</language>",
    `    <atom:link href="${base}/blog/rss.xml" rel="self" type="application/rss+xml" />`,
    ...items,
    "  </channel>",
    "</rss>",
    "",
  ].join("\n");
  return new Response(feed, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
