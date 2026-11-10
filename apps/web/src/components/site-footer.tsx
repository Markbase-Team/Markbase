import Link from "next/link";

// Shared public footer for the marketing/app surfaces (landing + root + login),
// styled to match the Amplyo landing: brand left, links right, copyright on a
// divided bottom row. Links to the legal pages — also referenced from the
// Google OAuth consent screen. Inherits the surrounding font (Outfit on the
// landing, the app font elsewhere).
export function SiteFooter() {
  return (
    <footer className="border-t border-[#efeff1] px-6 py-10">
      <div className="mx-auto max-w-5xl">
        <div className="flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-center">
          <span className="text-base font-extrabold tracking-tight text-neutral-900">
            Markbase
          </span>
          <nav className="flex flex-wrap items-center gap-6 text-sm text-[#a1a1aa]">
            <Link href="/privacy-policy" className="transition-colors hover:text-neutral-900">
              Privacy Policy
            </Link>
            <Link href="/terms" className="transition-colors hover:text-neutral-900">
              Terms
            </Link>
            <Link href="/login" className="transition-colors hover:text-neutral-900">
              Log in
            </Link>
          </nav>
        </div>
        <div className="mt-6 border-t border-[#efeff1] pt-6">
          <span className="text-sm text-[#a1a1aa]">
            © {new Date().getFullYear()} Markbase. All rights reserved.
          </span>
        </div>
      </div>
    </footer>
  );
}
