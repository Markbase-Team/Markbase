import { REPO_URL } from "@markbase/protocol/downloads";
import { BLOG_POSTS } from "@/lib/blog";
import { DOCS_NAV, docsDescription, docsPage } from "@/lib/docs-nav";

// /llms.txt (llmstxt.org): what Markbase is and where its pages are, for AI
// crawlers and agents. Built from the docs' table of contents and the blog, so
// it lists exactly the pages that exist; it used to be a hand-written file that
// went on linking to pages long after they were deleted.

const SITE = "https://markbase.so";

const INTRO = `# Markbase

> One markdown folder for your team and its agents. A team's documents are plain .md files in a folder anyone can mount, often a repository's docs/ folder. A background sync keeps that folder and the cloud in step both ways: people edit in a WYSIWYG editor in the browser or the Mac app, agents such as Claude Code, Codex and Cursor edit the files on disk, and concurrent edits merge.

- Every change is attributed to the person or agent who made it, with version history.
- Comments anchor to the exact text. Documents are shared with roles (viewer, commenter, editor) or by link with people who have no account.
- Open source (Apache-2.0) and self-hostable on Supabase with Docker or Vercel; free to use at ${SITE}.
- Clients: the web app, a macOS desktop app, and a CLI (@markbase/cli) that runs the sync, an MCP server and the HTTP API.
- Source: ${REPO_URL}`;

function llmsTxt(): string {
  const sections = DOCS_NAV.map((section) => {
    const lines = section.pages.map((p) => {
      const found = docsPage(p.slug);
      const description = found ? `: ${docsDescription(found.markdown)}` : "";
      return `- [${p.title}](${SITE}/docs/${p.slug})${description}`;
    });
    return `## ${section.title}\n\n${lines.join("\n")}`;
  });
  const blog = [
    `- [Blog](${SITE}/blog): short notes on what changed, newest first. Feed: ${SITE}/blog/rss.xml`,
    ...BLOG_POSTS.map((p) => `- [${p.title}](${SITE}/blog/${p.slug}.md): ${p.summary}`),
  ];
  return [
    INTRO,
    ...sections,
    `## Blog\n\n${blog.join("\n")}`,
    `## Optional\n\n- [Releases](${SITE}/releases): the desktop app's releases\n- [Privacy](${SITE}/privacy-policy)\n- [Terms](${SITE}/terms)`,
  ].join("\n\n") + "\n";
}

export function GET(): Response {
  return new Response(llmsTxt(), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
