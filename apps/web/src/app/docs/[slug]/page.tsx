import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Markdown } from "@markbase/ui/markdown";
import { DocsBody } from "@/components/docs/docs-body";
import { DocsOutline } from "@/components/docs/docs-outline";
import { DocsQuestions } from "@/components/docs/docs-questions";
import { docsOutline, docsPage, docsPages } from "@/lib/docs-nav";

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

// Prose in the brand: headings set firmly, links underlined in lime, code
// blocks dark.
const PROSE = [
  "prose-zinc max-w-none",
  "prose-headings:scroll-mt-8 prose-headings:font-semibold prose-headings:tracking-tight",
  "prose-h1:text-4xl prose-h1:font-bold prose-h1:mb-6",
  "prose-h2:mt-12 prose-h2:border-t prose-h2:border-zinc-100 prose-h2:pt-8",
  "prose-a:font-medium prose-a:text-zinc-900 prose-a:underline prose-a:decoration-[#c7e600] prose-a:decoration-2 prose-a:underline-offset-4 hover:prose-a:decoration-zinc-900",
  "prose-code:rounded prose-code:bg-zinc-100 prose-code:px-1.5 prose-code:py-0.5 prose-code:font-medium prose-code:text-zinc-900",
  "prose-pre:rounded-xl prose-pre:bg-zinc-950 prose-pre:text-zinc-100",
  "[&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:font-normal [&_pre_code]:text-zinc-100",
  "prose-strong:text-zinc-900 prose-li:marker:text-zinc-400",
].join(" ");

export default async function DocsPageView({ params }: { params: Promise<{ slug: string }> }) {
  const found = docsPage((await params).slug);
  if (!found) notFound();
  const { page, markdown, previous, next } = found;
  const outline = docsOutline(markdown);

  return (
    <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_16rem] xl:gap-12">
      <article className="mx-auto flex min-h-[calc(100svh-8rem)] w-full max-w-3xl min-w-0 flex-col lg:min-h-[calc(100svh-6rem)]">
        <DocsBody markdown={markdown} section={page.section}>
          <Markdown content={markdown} headingIds className={PROSE} />
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
