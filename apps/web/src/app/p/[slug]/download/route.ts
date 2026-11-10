import { getPublishedTabs } from "@markbase/docs/server";
import { combineTabMarkdown, docFileSlug } from "@markbase/docs";

export const runtime = "nodejs";
// Match the published page's ISR window.
export const revalidate = 300;

// GET /p/:slug/download — the published document as a Markdown file. A plain
// attachment link so anonymous readers can download without any client JS.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const data = await getPublishedTabs(slug);
  if (!data) return new Response("Not found", { status: 404 });

  const markdown = combineTabMarkdown(data.tabs.map((t) => t.content));
  const filename = `${docFileSlug(data.tabs[0]?.title ?? "")}.md`;

  return new Response(markdown, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control":
        "public, max-age=0, s-maxage=300, stale-while-revalidate=86400",
    },
  });
}
