"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import type { DocsSection } from "@/lib/docs-nav";

// The docs' navigation. On a wide screen it is a full-height column against the
// left edge: the mark and name, a divider, then each section's pages, the
// current one in the brand lime. On a narrow screen it is a bar with the brand
// and a menu button that opens the same list.

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2.5">
      <Image src="/markbase-logo.png" alt="" width={32} height={32} className="size-8 rounded-lg" />
      <span className="text-lg font-bold tracking-tight">Markbase</span>
      <span className="rounded-md border border-zinc-200 px-1.5 py-0.5 text-[11px] font-medium text-zinc-500">Docs</span>
    </Link>
  );
}

function NavList({ nav, onNavigate }: { nav: DocsSection[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="space-y-7 text-sm">
      {nav.map((section) => (
        <div key={section.title}>
          <div className="mb-2 px-3 text-[11px] font-semibold tracking-wider text-zinc-500 uppercase">
            {section.title}
          </div>
          <ul className="space-y-0.5">
            {section.pages.map((p) => {
              const href = `/docs/${p.slug}`;
              const active = pathname === href;
              return (
                <li key={p.slug}>
                  <Link
                    href={href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={
                      active
                        ? "block rounded-lg bg-[#e5ff6e] px-3 py-2 font-semibold text-zinc-900"
                        : "block rounded-lg px-3 py-2 text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900"
                    }
                  >
                    {p.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function DocsSidebar({ nav }: { nav: DocsSection[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {/* Narrow screens: brand and a menu button. */}
      <div className="border-b border-zinc-100 px-6 py-4 lg:hidden">
        <div className="flex items-center justify-between">
          <Brand />
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-label={open ? "Close the docs menu" : "Open the docs menu"}
            className="rounded-md p-2 text-zinc-600 hover:bg-zinc-100"
          >
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
        {open && (
          <div className="mt-4 border-t border-zinc-100 pt-4">
            <NavList nav={nav} onNavigate={() => setOpen(false)} />
          </div>
        )}
      </div>

      {/* Wide screens: a full-height column against the left edge. */}
      <aside className="hidden border-r border-zinc-200 bg-zinc-50/70 lg:block">
        <div className="sticky top-0 flex max-h-svh flex-col overflow-y-auto px-5 py-6">
          <Brand />
          <div className="my-6 h-px bg-zinc-200" />
          <NavList nav={nav} />
        </div>
      </aside>
    </>
  );
}
