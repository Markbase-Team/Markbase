import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { Markdown } from "@markbase/ui/markdown";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { BLOG_POSTS, blogDate, blogPost, blogSections } from "@/lib/blog";
import { SITE_PROSE } from "@/lib/site-prose";

// One blog post: a breadcrumb back to the list, the kind and date, the title, the
// lead, then the body's sections — a bulleted list as titled paragraphs, a
// numbered list as the dark steps block (the conventions are in @/lib/blog) —
// and up to two other posts, then the site footer. Sections are set apart by space and
// tint; there are no rules.

export function generateStaticParams() {
  return BLOG_POSTS.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const found = blogPost((await params).slug);
  return found
    ? { title: `${found.post.title} — Markbase`, description: found.post.summary }
    : {};
}

/** The lead: one large paragraph under the title. */
const LEAD = "prose-p:my-0 prose-p:text-[22px] prose-p:leading-normal prose-p:text-zinc-700";

/** A section's body: ordinary prose; each bullet a bold title over its text, no markers. */
const SECTION = [
  SITE_PROSE,
  "max-w-3xl prose-base prose-p:text-zinc-600",
  "prose-ul:my-0 prose-ul:list-none prose-ul:p-0 [&_ul>li+li]:mt-7",
  "prose-li:my-0 prose-li:p-0 prose-li:text-[17px] prose-li:leading-relaxed prose-li:text-zinc-600",
  "[&_li>strong:first-child]:mb-1 [&_li>strong:first-child]:block [&_li>strong:first-child]:text-[19px] [&_li>strong:first-child]:font-semibold",
].join(" ");

/** The text beside a steps block's heading, on the dark ground. */
const STEPS_INTRO = "prose-p:my-0 prose-p:text-base prose-p:leading-relaxed prose-p:text-zinc-300";

/** The steps themselves: no markers, each numbered in a lime circle. */
const STEPS = [
  "prose-base text-white prose-strong:text-white",
  "prose-ol:my-0 prose-ol:list-none prose-ol:p-0 [&_ol>li+li]:mt-4 prose-ol:[counter-reset:step]",
  "prose-li:relative prose-li:my-0 prose-li:min-h-7 prose-li:pl-11 prose-li:leading-7 prose-li:text-[17px] prose-li:text-white prose-li:[counter-increment:step]",
  "[&_li]:before:absolute [&_li]:before:top-0 [&_li]:before:left-0 [&_li]:before:flex [&_li]:before:size-7 [&_li]:before:items-center [&_li]:before:justify-center [&_li]:before:rounded-full [&_li]:before:bg-[#e5ff6e] [&_li]:before:text-sm [&_li]:before:font-bold [&_li]:before:text-zinc-900 [&_li]:before:content-[counter(step)]",
  "prose-code:rounded prose-code:bg-white/15 prose-code:px-1.5 prose-code:py-0.5 prose-code:font-medium prose-code:text-white",
].join(" ");

export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const found = blogPost((await params).slug);
  if (!found) notFound();
  const { post, markdown } = found;
  const { lead, sections } = blogSections(markdown);
  const more = BLOG_POSTS.filter((p) => p.slug !== post.slug).slice(0, 2);

  return (
    <div className="flex min-h-svh flex-col bg-white text-zinc-900">
      <SiteHeader />
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-12">
        <article className="space-y-16">
          <header className="max-w-3xl">
            <nav aria-label="Breadcrumb">
              <ol className="flex min-w-0 items-center gap-1.5 text-sm text-zinc-600">
                <li>
                  <Link href="/blog" className="py-2 font-medium transition hover:text-zinc-900">
                    Blog
                  </Link>
                </li>
                <li aria-hidden="true">
                  <ChevronRight className="size-3.5 text-zinc-400" />
                </li>
                <li aria-current="page" className="min-w-0 truncate text-zinc-900">
                  {post.title}
                </li>
              </ol>
            </nav>
            <div className="mt-6 flex items-center gap-2.5 text-sm text-zinc-600">
              <span className="rounded-full bg-[#e5ff6e] px-2.5 py-1 text-xs font-semibold text-zinc-900">
                {post.kind}
              </span>
              <time dateTime={post.date}>{blogDate(post.date)}</time>
            </div>
            <h1 className="mt-5 text-4xl leading-[1.05] font-bold tracking-tight sm:text-6xl">{post.title}</h1>
            {lead && <Markdown content={lead} className={`mt-6 ${SITE_PROSE} ${LEAD}`} />}
          </header>

          {sections.map((section) =>
            section.steps ? (
              <section
                key={section.title}
                className="flex flex-wrap gap-x-14 gap-y-6 rounded-[28px] bg-zinc-900 p-8 text-white sm:p-10"
              >
                <div className="min-w-0 flex-[1_1_16rem]">
                  <h2 className="text-[28px] font-bold tracking-tight">{section.title}</h2>
                  {section.body && <Markdown content={section.body} className={`mt-2 ${STEPS_INTRO}`} />}
                </div>
                <Markdown content={section.steps} className={`min-w-0 flex-[2_1_26rem] ${STEPS}`} />
              </section>
            ) : (
              <section key={section.title}>
                <h2 className="mb-6 text-[28px] font-bold tracking-tight">{section.title}</h2>
                <Markdown content={section.body} className={SECTION} />
              </section>
            )
          )}

          {more.length > 0 && (
            <section>
              <h2 className="mb-5 text-sm font-semibold text-zinc-600">More posts</h2>
              <ul className="grid gap-4 sm:grid-cols-2">
                {more.map((p) => (
                  <li key={p.slug}>
                    <Link
                      href={`/blog/${p.slug}`}
                      className="block rounded-3xl bg-zinc-100 p-7 transition hover:bg-zinc-200"
                    >
                      <span className="text-[13px] text-zinc-600">
                        {p.kind} · {blogDate(p.date)}
                      </span>
                      <h3 className="mt-2.5 text-xl leading-tight font-semibold tracking-tight">{p.title}</h3>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </article>
      </main>
      <SiteFooter />
    </div>
  );
}
