import Image from "next/image";
import Link from "next/link";

// The site's top bar — the landing's and every public page's (docs, say), so
// they read as one site. Sticky, translucent, with Docs and Sign in for wide
// screens and the one button that matters everywhere.

export const SITE_PRIMARY_BTN =
  "inline-flex items-center justify-center gap-2 rounded-lg bg-[#e5ff6e] px-5 py-2.5 text-sm font-semibold text-zinc-900 transition hover:brightness-95";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-20 border-b border-zinc-100 bg-white/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-2">
          <Image src="/markbase-logo.png" alt="Markbase logo" width={26} height={26} className="size-6 object-contain" />
          <span className="text-base font-semibold tracking-tight">Markbase</span>
        </Link>
        <nav className="flex items-center gap-3">
          <Link href="/docs" className="hidden text-sm font-medium text-zinc-600 transition hover:text-zinc-900 sm:inline">
            Docs
          </Link>
          <Link href="/login" className="hidden text-sm font-medium text-zinc-600 transition hover:text-zinc-900 sm:inline">
            Sign in
          </Link>
          <Link href="/login" className={SITE_PRIMARY_BTN}>
            Get started
          </Link>
        </nav>
      </div>
    </header>
  );
}
