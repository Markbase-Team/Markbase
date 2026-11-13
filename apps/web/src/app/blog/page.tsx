import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { blogDate, blogPostsByMonth } from "@/lib/blog";

export const metadata = {
  title: "Blog — Markbase",
  description: "Short notes on what changed in Markbase, newest first.",
};

// The blog's front page: every post, newest first (the order of BLOG_POSTS in
// @/lib/blog), in sections by month — the month in a left column, its posts
// as cards beside it. Sections are set apart by space and the cards' tint,
// with no rules between them.
export default function BlogPage() {
  return (
    <div className="min-h-svh bg-white text-zinc-900">
      <SiteHeader />
      <main className="mx-auto w-full max-w-6xl px-6 py-12">
        <div className="max-w-3xl">
          <h1 className="text-4xl font-bold tracking-tight">Blog</h1>
          <p className="mt-3 text-zinc-600">Short notes on what changed in Markbase.</p>

          <div className="mt-12 space-y-12">
            {blogPostsByMonth().map((group) => (
              <section key={group.month} className="grid gap-4 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-8">
                <h2 className="text-sm font-semibold text-zinc-500 sm:pt-5">{group.month}</h2>
                <ul className="space-y-3">
                  {group.posts.map((post) => (
                    <li key={post.slug}>
                      <Link
                        href={`/blog/${post.slug}`}
                        className="group block rounded-2xl bg-zinc-50 p-5 transition hover:bg-zinc-100"
                      >
                        <h3 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
                          {post.title}
                          <ArrowRight className="size-4 shrink-0 text-zinc-400 transition group-hover:translate-x-0.5 group-hover:text-zinc-900" />
                        </h3>
                        <p className="mt-1.5 text-zinc-600">{post.summary}</p>
                        <time dateTime={post.date} className="mt-3 block text-sm text-zinc-500">
                          {blogDate(post.date)}
                        </time>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
