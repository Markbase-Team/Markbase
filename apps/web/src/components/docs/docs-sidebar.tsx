"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import type { DocsSection } from "@/lib/docs-nav";

// The docs' navigation: the mark and name at the top, a divider, then each
// section's pages. On a wide screen it is a sticky column; on a narrow one it
// is a bar with the brand and a menu button that opens the same list.

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2">
      <Image src="/logo.png" alt="" width={28} height={28} className="size-7 object-contain" />
      <span className="text-base font-bold tracking-tight">Markbase</span>
    </Link>
  );
}

function NavList({ nav, onNavigate }: { nav: DocsSection[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="space-y-6 text-sm">
      {nav.map((section) => (
        <div key={section.title}>
          <div className="mb-2 font-semibold text-zinc-900">{section.title}</div>
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
                        ? "block rounded-md bg-zinc-100 px-2 py-1.5 font-medium text-zinc-900"
                        : "block rounded-md px-2 py-1.5 text-zinc-600 transition hover:bg-zinc-50 hover:text-zinc-900"
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
      <div className="mb-8 lg:hidden">
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

      {/* Wide screens: a sticky column. */}
      <aside className="hidden lg:block">
        <div className="sticky top-12 max-h-[calc(100svh-6rem)] overflow-y-auto pr-2">
          <Brand />
          <div className="my-5 h-px bg-zinc-100" />
          <NavList nav={nav} />
        </div>
      </aside>
    </>
  );
}
