import { BlogList } from "@/components/blog-list";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { BLOG_POSTS } from "@/lib/blog";

export const metadata = {
  title: "Blog — Markbase",
  description: "What changed in Markbase, in short notes, newest first.",
};

// The blog's front page: the title, then every post, newest first (the order
// of BLOG_POSTS in @/lib/blog), filtered and laid out by month in BlogList.
export default function BlogPage() {
  return (
    <div className="flex min-h-svh flex-col bg-white text-zinc-900">
      <SiteHeader />
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-12">
        <h1 className="text-5xl font-bold tracking-tight sm:text-6xl">Blog</h1>
        <p className="mt-3 mb-8 text-lg text-zinc-600">What changed in Markbase, in short notes.</p>
        <BlogList posts={BLOG_POSTS} />
      </main>
      <SiteFooter />
    </div>
  );
}
