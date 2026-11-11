import type { ReactNode } from "react";
import { DocsSidebar } from "@/components/docs/docs-sidebar";
import { DOCS_NAV } from "@/lib/docs-nav";

// Every docs page: the sidebar on the left, the page (its content and its
// outline) beside it, in the site's standard section width.
export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-svh bg-white text-zinc-900">
      <main className="mx-auto w-full max-w-6xl px-6 py-12 lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-10">
        <DocsSidebar nav={DOCS_NAV} />
        <div className="min-w-0">{children}</div>
      </main>
    </div>
  );
}
