import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Markdown } from "@markbase/ui/markdown";
import { DocsBody } from "@/components/docs/docs-body";
import { DocsOutline } from "@/components/docs/docs-outline";
import { DocsQuestions } from "@/components/docs/docs-questions";
import { DOCS_MOVED, docsOutline, docsPage, docsPages } from "@/lib/docs-nav";
import { SITE_PROSE } from "@/lib/site-prose";

// One docs page: the content in the middle, with "Copy markdown" above it; the
// page's outline and a way to ask a question on the right; and Previous / Next
// at the foot of the page in sidebar order — at the bottom of the window when
// the page is shorter than it. The content is apps/web/content/docs/<slug>.md.

export function generateStaticParams() {
  return docsPages().map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const found = docsPage((await params).slug);
  return found ? { title: `${found.page.title} — Markbase docs` } : {};
}

export default async function DocsPageView({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const found = docsPage(slug);
  if (!found) {
    const moved = DOCS_MOVED[slug];
    if (moved) permanentRedirect(moved);
    notFound();
  }
  const { page, markdown, previous, next } = found;
  const outline = docsOutline(markdown);

  return (
    <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_16rem] xl:gap-12">
      <article className="mx-auto flex min-h-[calc(100svh-8rem)] w-full max-w-3xl min-w-0 flex-col lg:min-h-[calc(100svh-6rem)]">
        <DocsBody markdown={markdown} section={page.section}>
          <Markdown content={markdown} headingIds className={SITE_PROSE} />
        </DocsBody>

        <div className="mt-auto pt-16">
        <DocsQuestions className="mb-8 xl:hidden" />
        <nav className="grid gap-3 sm:grid-cols-2" aria-label="Previous and next page">
          {previous ? (
            <Link href={`/docs/${previous.slug}`} className="group rounded-xl border border-zinc-200 p-4 transition hover:border-zinc-900">
              <div className="flex items-center gap-1.5 text-xs font-medium text-zinc-500">
                <ArrowLeft className="size-3.5 transition group-hover:-translate-x-0.5" /> Previous
              </div>
              <div className="mt-1 font-semibold text-zinc-900">{previous.title}</div>
            </Link>
          ) : (
            <span />
          )}
          {next && (
            <Link href={`/docs/${next.slug}`} className="group rounded-xl border border-zinc-200 p-4 text-right transition hover:border-zinc-900">
              <div className="flex items-center justify-end gap-1.5 text-xs font-medium text-zinc-500">
                Next <ArrowRight className="size-3.5 transition group-hover:translate-x-0.5" />
              </div>
              <div className="mt-1 font-semibold text-zinc-900">{next.title}</div>
            </Link>
          )}
        </nav>
        </div>
      </article>

      <aside className="hidden xl:block">
        <div className="sticky top-12 space-y-8">
          {outline.length > 0 && <DocsOutline items={outline} />}
          <DocsQuestions />
        </div>
      </aside>
    </div>
  );
}
