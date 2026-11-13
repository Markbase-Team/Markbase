import { BLOG_POSTS, blogMarkdownDocument, blogPost } from "@/lib/blog";

// GET /blog/<slug>.md (rewritten here in next.config.ts) — the post as
// markdown: what it was written in, and what an AI crawler reads most
// reliably. Shown in the browser, not downloaded.

export function generateStaticParams() {
  return BLOG_POSTS.map((p) => ({ slug: p.slug }));
}

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const found = blogPost((await params).slug);
  if (!found) return new Response("Not found", { status: 404 });
  return new Response(blogMarkdownDocument(found.post, found.markdown), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
