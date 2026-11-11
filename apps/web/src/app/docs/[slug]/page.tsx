import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Markdown } from "@markbase/ui/markdown";
import { DocsBody } from "@/components/docs/docs-body";
import { docsOutline, docsPage, docsPages } from "@/lib/docs-nav";

// One docs page: the content in the middle (rendered, with its markdown a click
// away), the page's outline on the right, and Previous / Next at the bottom in
// sidebar order. The content is apps/web/content/docs/<slug>.md.

export function generateStaticParams() {
  return docsPages().map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const found = docsPage((await params).slug);
  return found ? { title: `${found.page.title} — Markbase docs` } : {};
}

export default async function DocsPageView({ params }: { params: Promise<{ slug: string }> }) {
  const found = docsPage((await params).slug);
  if (!found) notFound();
  const { page, markdown, previous, next } = found;
  const outline = docsOutline(markdown);

  return (
    <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_12rem] xl:gap-10">
      <article className="min-w-0 max-w-3xl">
        <DocsBody markdown={markdown} section={page.section}>
          <Markdown content={markdown} headingIds className="prose-zinc max-w-none prose-headings:scroll-mt-12 prose-h1:text-3xl prose-h1:tracking-tight" />
        </DocsBody>

        <nav className="mt-16 grid gap-3 border-t border-zinc-100 pt-8 sm:grid-cols-2" aria-label="Previous and next page">
          {previous ? (
            <Link href={`/docs/${previous.slug}`} className="group rounded-lg border border-zinc-200 p-4 transition hover:border-zinc-300 hover:bg-zinc-50">
              <div className="flex items-center gap-1.5 text-xs text-zinc-500">
                <ArrowLeft className="size-3.5" /> Previous
              </div>
              <div className="mt-1 font-medium text-zinc-900">{previous.title}</div>
            </Link>
          ) : (
            <span />
          )}
          {next && (
            <Link href={`/docs/${next.slug}`} className="group rounded-lg border border-zinc-200 p-4 text-right transition hover:border-zinc-300 hover:bg-zinc-50">
              <div className="flex items-center justify-end gap-1.5 text-xs text-zinc-500">
                Next <ArrowRight className="size-3.5" />
              </div>
              <div className="mt-1 font-medium text-zinc-900">{next.title}</div>
            </Link>
          )}
        </nav>
      </article>

      {outline.length > 0 && (
        <aside className="hidden xl:block">
          <div className="sticky top-12">
            <div className="mb-3 text-xs font-semibold tracking-wide text-zinc-900 uppercase">On this page</div>
            <ul className="space-y-2 border-l border-zinc-100 text-sm">
              {outline.map((h) => (
                <li key={h.id} className={h.depth === 3 ? "pl-6" : "pl-3"}>
                  <a href={`#${h.id}`} className="text-zinc-500 transition hover:text-zinc-900">
                    {h.text}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      )}
    </div>
  );
}
