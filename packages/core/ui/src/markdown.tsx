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
export function Markdown({
  content,
  className,
  onOpenFile,
}: {
  content: string;
  className?: string;
  /** When set, inline code that looks like a file path becomes a clickable link
   *  calling this with the path — used to jump to a referenced doc. `newTab` is
   *  set on a ⌘/Ctrl-click. */
  onOpenFile?: (path: string, opts?: { newTab: boolean }) => void;
}) {
  const components: Components | undefined = onOpenFile
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
