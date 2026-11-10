"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@markbase/ui/utils";

// A published multi-tab doc, styled to match the editor (prose prose-sm +
// tiptap.css): all tabs stacked in one scroll, with a sticky rail on the RIGHT
// that scroll-spies the current section and jumps to it on click. Every section
// is in the HTML, so search + AI crawlers see all tabs. Read-only.
export function PublishedTabs({
  tabs,
}: {
  tabs: { id: string; title: string; html: string }[];
}) {
  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLElement | null)[]>([]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort(
            (a, b) => a.boundingClientRect.top - b.boundingClientRect.top
          );
        if (visible[0]) {
          const idx = refs.current.indexOf(visible[0].target as HTMLElement);
          if (idx >= 0) setActive(idx);
        }
      },
      { rootMargin: "0px 0px -75% 0px" }
    );
    refs.current.forEach((el) => el && observer.observe(el));
    return () => observer.disconnect();
  }, [tabs]);

  function jumpTo(i: number) {
    refs.current[i]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="flex flex-col-reverse gap-8 md:flex-row md:gap-10">
      <div className="min-w-0 flex-1">
        {tabs.map((t, i) => (
          <section
            key={t.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            aria-label={t.title}
            className={cn(
              "scroll-mt-8",
              i > 0 && "mt-14 border-t border-border/60 pt-14"
            )}
          >
            <article
              className="ProseMirror prose prose-sm max-w-none dark:prose-invert"
              dangerouslySetInnerHTML={{ __html: t.html }}
            />
          </section>
        ))}
      </div>

      <nav
        aria-label="Document tabs"
        className="shrink-0 md:sticky md:top-12 md:h-fit md:w-44 md:self-start"
      >
        <div className="mb-2 hidden text-xs font-medium tracking-wide text-muted-foreground uppercase md:block">
          Tabs
        </div>
        <div className="flex flex-wrap gap-1 md:flex-col">
          {tabs.map((t, i) => (
            <button
              key={t.id}
              type="button"
              onClick={() => jumpTo(i)}
              aria-current={i === active ? "page" : undefined}
              className={cn(
                "rounded-md px-3 py-1.5 text-left text-sm transition-colors",
                i === active
                  ? "bg-muted font-medium text-foreground"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              )}
            >
              {t.title}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
