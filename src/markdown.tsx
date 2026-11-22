import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "./utils";

// A path-shaped inline-code token: no whitespace, and either a doc extension or a
// slash — so `docs/foo.md`, `foo.md`, `learning/01-foo` match, while `useState`
// and `npm install` don't.
function looksLikeDocPath(s: string): boolean {
  const t = s.trim();
  if (!t || /\s/.test(t)) return false;
  return /\.mdx?$/i.test(t) || (t.includes("/") && /^[\w./~-]+$/.test(t));
}

// Reusable markdown renderer. Pass a markdown string; styled via Tailwind
// Typography (`prose`). The consumer must have the @tailwindcss/typography
// plugin enabled. Use anywhere markdown needs to be displayed.
/**
 * The anchor a heading gets: lower-case, words joined by hyphens, punctuation
 * dropped. Shared by the renderer (the id) and anything that lists a page's
 * headings (the link), so the two always agree.
 */
export function headingSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[`*_~]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

/** The plain text of a hast node and everything under it. */
interface HastLike {
  type?: string;
  value?: string;
  children?: HastLike[];
}
function hastText(node: HastLike | undefined): string {
  if (!node) return "";
  if (typeof node.value === "string") return node.value;
  return (node.children ?? []).map(hastText).join("");
}

export function Markdown({
  content,
  className,
  onOpenFile,
  headingIds = false,
}: {
  content: string;
  className?: string;
  /** Give h2 and h3 an id from `headingSlug`, so a page outline can link to them. */
  headingIds?: boolean;
  /** When set, inline code that looks like a file path becomes a clickable link
   *  calling this with the path — used to jump to a referenced doc. `newTab` is
   *  set on a ⌘/Ctrl-click. */
  onOpenFile?: (path: string, opts?: { newTab: boolean }) => void;
}) {
  const headings: Components = headingIds
    ? {
        h2: ({ node, children }) => <h2 id={headingSlug(hastText(node as HastLike))}>{children}</h2>,
        h3: ({ node, children }) => <h3 id={headingSlug(hastText(node as HastLike))}>{children}</h3>,
      }
    : {};
  const fileLinks: Components | undefined = onOpenFile
    ? {
        code({ className: cls, children }) {
          const text = String(children ?? "");
          // Fenced/block code carries a `language-*` class; inline code doesn't.
          const isInline = !/\blanguage-/.test(cls ?? "");
          if (isInline && looksLikeDocPath(text)) {
            const open = (e: { metaKey: boolean; ctrlKey: boolean }) =>
              onOpenFile(text.trim(), { newTab: e.metaKey || e.ctrlKey });
            return (
              <code
                className={cn(
                  cls,
                  "cursor-pointer underline decoration-dotted underline-offset-2 hover:decoration-solid"
                )}
                role="button"
                tabIndex={0}
                onClick={open}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    open(e);
                  }
                }}
              >
                {children}
              </code>
            );
          }
          return <code className={cls}>{children}</code>;
        },
      }
    : undefined;
  const components: Components = { ...headings, ...(fileLinks ?? {}) };
  return (
    <div
      className={cn(
        "prose prose-sm max-w-none dark:prose-invert prose-pre:bg-muted prose-pre:text-foreground prose-code:before:content-[''] prose-code:after:content-['']",
        className
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
