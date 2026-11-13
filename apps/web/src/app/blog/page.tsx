import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { BLOG_POSTS, blogDate } from "@/lib/blog";

export const metadata = {
  title: "Blog — Markbase",
  description: "Short notes on what changed in Markbase, newest first.",
};

// The blog's front page: every post, newest first (the order of BLOG_POSTS in
// @/lib/blog), each a date, a title and a line of summary that links to it.
export default function BlogPage() {
  return (
    <div className="min-h-svh bg-white text-zinc-900">
      <SiteHeader />
      <main className="mx-auto w-full max-w-6xl px-6 py-12">
        <div className="max-w-3xl">
          <h1 className="text-4xl font-bold tracking-tight">Blog</h1>
          <p className="mt-3 text-zinc-600">Short notes on what changed in Markbase.</p>

          <ul className="mt-10 divide-y divide-zinc-100 border-t border-zinc-100">
            {BLOG_POSTS.map((post) => (
              <li key={post.slug}>
                <Link href={`/blog/${post.slug}`} className="group block py-6">
                  <time dateTime={post.date} className="text-sm text-zinc-500">
                    {blogDate(post.date)}
                  </time>
                  <h2 className="mt-1 flex items-center gap-2 text-xl font-semibold tracking-tight">
                    <span className="underline decoration-transparent decoration-2 underline-offset-4 transition group-hover:decoration-[#c7e600]">
                      {post.title}
                    </span>
                    <ArrowRight className="size-4 shrink-0 text-zinc-400 transition group-hover:translate-x-0.5 group-hover:text-zinc-900" />
                  </h2>
                  <p className="mt-2 text-zinc-600">{post.summary}</p>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </main>
    </div>
  );
}
