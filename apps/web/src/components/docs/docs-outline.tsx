"use client";

import { useEffect, useState } from "react";
import type { OutlineItem } from "@/lib/docs-nav";

// "On this page": the page's h2 and h3 headings, with the one you are reading
// marked as you scroll. A heading counts as current once it passes the top
// fifth of the window; above the first one, the first is current; and once you
// have scrolled to the bottom the last one is, since a short page cannot scroll
// its last headings up that far. A page that does not scroll at all keeps the
// first.
export function DocsOutline({ items }: { items: OutlineItem[] }) {
  const [active, setActive] = useState<string | null>(items[0]?.id ?? null);

  useEffect(() => {
    const headings = items
      .map((i) => document.getElementById(i.id))
      .filter((el): el is HTMLElement => el !== null);
    if (headings.length === 0) return;
    const pick = () => {
      const line = window.innerHeight * 0.2;
      let current = headings[0].id;
      for (const h of headings) if (h.getBoundingClientRect().top <= line) current = h.id;
      const atBottom =
        window.scrollY > 0 && window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
      setActive(atBottom ? headings[headings.length - 1].id : current);
    };
    pick();
    window.addEventListener("scroll", pick, { passive: true });
    window.addEventListener("resize", pick);
    return () => {
      window.removeEventListener("scroll", pick);
      window.removeEventListener("resize", pick);
    };
  }, [items]);

  return (
    <div>
      <div className="mb-3 text-[11px] font-semibold tracking-wider text-zinc-500 uppercase">On this page</div>
      <ul className="space-y-1 border-l-2 border-zinc-100 text-sm">
        {items.map((h) => {
          const current = h.id === active;
          return (
            <li key={h.id}>
              <a
                href={`#${h.id}`}
                aria-current={current ? "location" : undefined}
                className={[
                  "-ml-[2px] block border-l-2 py-1 transition",
                  h.depth === 3 ? "pl-6" : "pl-3",
                  current
                    ? "border-[#c7e600] font-medium text-zinc-900"
                    : "border-transparent text-zinc-500 hover:text-zinc-900",
                ].join(" ")}
              >
                {h.text}
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
