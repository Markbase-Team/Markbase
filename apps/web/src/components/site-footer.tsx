import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { MAC_DOWNLOAD_URL, REPO_URL } from "@markbase/protocol/downloads";

// The site's footer — the landing's and the blog's, so they end the same way:
// the brand line, the Product and Company links, and how to stay in touch. Set
// apart from the page by its tint rather than a rule.

const STAY_IN_TOUCH_HREF = "/#stay-in-touch";

const PRODUCT: [string, string][] = [
  ["Docs", "/docs"],
  ["GitHub", REPO_URL],
  ["Download for Mac", MAC_DOWNLOAD_URL],
  ["Releases", "/releases"],
  ["Blog", "/blog"],
  ["Sign in", "/login"],
  ["Get started", "/login"],
];

const COMPANY: [string, string][] = [
  ["Privacy", "/privacy-policy"],
  ["Terms", "/terms"],
];

export function SiteFooter() {
  return (
    <footer className="bg-zinc-50 px-6 py-14">
      <div className="mx-auto max-w-6xl">
        <div className="grid gap-10 md:grid-cols-[1.5fr_1fr_1fr_1.5fr]">
          <div>
            <div className="flex items-center gap-2">
              <Image src="/markbase-logo.png" alt="" width={24} height={24} className="size-6 object-contain" />
              <span className="text-base font-semibold">Markbase</span>
            </div>
            <p className="mt-3 max-w-xs text-sm text-zinc-600">
              One markdown folder for your team and its agents.
            </p>
          </div>
          <FooterCol title="Product" links={PRODUCT} />
          <FooterCol title="Company" links={COMPANY} />
          <div>
            <div className="text-sm font-semibold text-zinc-900">Stay in touch</div>
            <p className="mt-2 max-w-xs text-sm text-zinc-600">Get product updates and early access.</p>
            <Link
              href={STAY_IN_TOUCH_HREF}
              className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-zinc-900 hover:underline"
            >
              Join the list <ArrowRight className="size-3.5" />
            </Link>
            <a href="mailto:hello@markbase.so" className="mt-3 block text-sm text-zinc-600 hover:text-zinc-900">
              hello@markbase.so
            </a>
          </div>
        </div>
        <div className="mt-12 text-sm text-zinc-500">
          © {new Date().getFullYear()} Markbase. All rights reserved.
        </div>
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <div className="text-sm font-semibold text-zinc-900">{title}</div>
      <ul className="mt-3 space-y-2">
        {links.map(([label, href]) => (
          <li key={label}>
            <Link href={href} className="text-sm text-zinc-600 transition hover:text-zinc-900">
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
