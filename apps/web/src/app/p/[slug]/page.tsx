import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Download } from "lucide-react";
import { getPublishedTabs, getUserDisplay } from "@markbase/docs/server";
import { markdownToHtml, excerpt } from "@markbase/docs/html";
import { cn } from "@/lib/utils";
import { PublishedTabs } from "@markbase/docs/ui/published-tabs";
// Reuse the editor's content styling so published pages look identical.
import "@markbase/docs/ui/tiptap.css";
import { MermaidDiagrams } from "@markbase/docs/ui/mermaid-diagrams";

// ISR: cache the public page, refresh a few minutes after an edit.
export const revalidate = 300;

function baseUrl(): string {
  return process.env.APP_URL ?? "https://markbase.so";
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const data = await getPublishedTabs(slug);
  if (!data) return { title: "Not found", robots: { index: false } };

  const first = data.tabs[0];
  const description = excerpt(first.content);
  const url = `${baseUrl()}/p/${slug}`;
  return {
    metadataBase: new URL(baseUrl()),
    title: first.title,
    description,
    alternates: { canonical: `/p/${slug}` },
    openGraph: {
      type: "article",
      title: first.title,
      description,
      url,
      publishedTime: data.publishedAt ?? undefined,
      modifiedTime: data.updatedAt,
    },
    twitter: { card: "summary_large_image", title: first.title, description },
  };
}

export default async function PublishedDocPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const data = await getPublishedTabs(slug);
  if (!data) notFound();

  const owner = await getUserDisplay(data.ownerId);
  // The name the owner chose, else their sign-in's — never their email: this
  // page is public.
  const authorName = owner.name || "Markbase";
  const tabs = data.tabs.map((t) => ({
    id: t.id,
    title: t.title,
    html: markdownToHtml(t.content),
  }));

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: tabs[0].title,
    description: excerpt(data.tabs[0].content),
    datePublished: data.publishedAt ?? undefined,
    dateModified: data.updatedAt,
    author: { "@type": "Person", name: authorName },
    mainEntityOfPage: { "@type": "WebPage", "@id": `${baseUrl()}/p/${slug}` },
  };

  const hasTabs = tabs.length > 1;
  return (
    <main
      className={cn(
        "mx-auto w-full px-6 py-12",
        hasTabs ? "max-w-5xl" : "max-w-3xl"
      )}
    >
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      {hasTabs ? (
        <PublishedTabs tabs={tabs} />
      ) : (
        <article
          className="ProseMirror prose prose-sm max-w-none dark:prose-invert"
          dangerouslySetInnerHTML={{ __html: tabs[0].html }}
        />
      )}
      {/* Draws any ```mermaid the server could only emit as source. Covers both
          branches above — tabs render into the same document. */}
      <MermaidDiagrams />
      <footer className="mt-16 flex flex-wrap items-center gap-x-2 gap-y-1 border-t pt-6 text-sm text-muted-foreground">
        <span>Published by {authorName}</span>
        <span aria-hidden>·</span>
        <a
          href={`/p/${slug}/download`}
          download
          className="inline-flex items-center gap-1 font-medium text-foreground hover:underline"
        >
          <Download className="size-3.5" />
          Download .md
        </a>
        <span aria-hidden>·</span>
        <Link href="/" className="font-medium text-foreground hover:underline">
          Made with Markbase
        </Link>
      </footer>
    </main>
  );
}
