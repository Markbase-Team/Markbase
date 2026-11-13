import type { Metadata } from "next";
import { BlogList } from "@/components/blog-list";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { BLOG_POSTS, blogPath, siteUrl } from "@/lib/blog";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: "Blog — Markbase",
  description: "What changed in Markbase, in short notes, newest first.",
  alternates: { canonical: blogPath(), types: { "application/rss+xml": "/blog/rss.xml" } },
  openGraph: {
    type: "website",
    title: "Markbase blog",
    description: "What changed in Markbase, in short notes, newest first.",
    url: blogPath(),
    siteName: "Markbase",
  },
};

/** The blog and its posts, for search engines and AI answers. */
function structuredData() {
  const base = siteUrl();
  return {
    "@context": "https://schema.org",
    "@type": "Blog",
    name: "Markbase blog",
    description: "What changed in Markbase, in short notes.",
    url: `${base}${blogPath()}`,
    publisher: { "@type": "Organization", name: "Markbase", url: base },
    blogPost: BLOG_POSTS.map((post) => ({
      "@type": "BlogPosting",
      headline: post.title,
      description: post.summary,
      datePublished: `${post.date}T00:00:00Z`,
      url: `${base}${blogPath(post.slug)}`,
    })),
  };
}

// The blog's front page: the title, then every post, newest first (the order
// of BLOG_POSTS in @/lib/blog), filtered and laid out by month in BlogList.
export default function BlogPage() {
  return (
    <div className="flex min-h-svh flex-col bg-white text-zinc-900">
      <SiteHeader />
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-12">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData()).replace(/</g, "\\u003c") }}
        />
        <h1 className="text-5xl font-bold tracking-tight sm:text-6xl">Blog</h1>
        <p className="mt-3 mb-8 text-lg text-zinc-600">What changed in Markbase, in short notes.</p>
        <BlogList posts={BLOG_POSTS} />
      </main>
      <SiteFooter />
    </div>
  );
}
