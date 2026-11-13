import type { MetadataRoute } from "next";
import { listPublishedDocs } from "@markbase/docs/server";
import { BLOG_POSTS } from "@/lib/blog";

export const revalidate = 300;

function baseUrl(): string {
  return process.env.APP_URL ?? "https://markbase.so";
}

// Lists the home page, the public legal pages, the blog, and every published doc so
// crawlers (Google, and AI bots like GPTBot / PerplexityBot / ClaudeBot) can
// discover pages that aren't linked from anywhere else. `changeFrequency` and
// `priority` are omitted — Google ignores both.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = baseUrl();
  const docs = await listPublishedDocs().catch(() => []);
  return [
    { url: base },
    { url: `${base}/privacy-policy` },
    { url: `${base}/terms` },
    { url: `${base}/blog` },
    ...BLOG_POSTS.map((p) => ({ url: `${base}/blog/${p.slug}`, lastModified: new Date(p.date) })),
    ...docs.map((d) => ({
      url: `${base}/p/${d.slug}`,
      lastModified: new Date(d.updatedAt),
    })),
  ];
}
