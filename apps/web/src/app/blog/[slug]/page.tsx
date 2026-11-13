import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Markdown } from "@markbase/ui/markdown";
import { SiteHeader } from "@/components/site-header";
import { BLOG_POSTS, blogDate, blogPost } from "@/lib/blog";
import { SITE_PROSE } from "@/lib/site-prose";

// One blog post: a way back to the list, the date and title from the post's
// entry in @/lib/blog, then its body, apps/web/content/blog/<slug>.md.

export function generateStaticParams() {
  return BLOG_POSTS.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const found = blogPost((await params).slug);
  return found
    ? { title: `${found.post.title} — Markbase`, description: found.post.summary }
    : {};
}

export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const found = blogPost((await params).slug);
  if (!found) notFound();
  const { post, markdown } = found;

  return (
    <div className="min-h-svh bg-white text-zinc-900">
      <SiteHeader />
      <main className="mx-auto w-full max-w-6xl px-6 py-12">
        <article className="max-w-3xl">
          <Link
            href="/blog"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-zinc-500 transition hover:text-zinc-900"
          >
            <ArrowLeft className="size-3.5" /> Blog
          </Link>
          <time dateTime={post.date} className="mt-8 block text-sm text-zinc-500">
            {blogDate(post.date)}
          </time>
          <h1 className="mt-2 mb-8 text-4xl font-bold tracking-tight">{post.title}</h1>
          <Markdown content={markdown} className={SITE_PROSE} />
        </article>
      </main>
    </div>
  );
}
