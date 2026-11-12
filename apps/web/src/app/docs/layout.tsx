import type { ReactNode } from "react";
import { DocsSidebar } from "@/components/docs/docs-sidebar";
import { DOCS_NAV } from "@/lib/docs-nav";

// Every docs page, full width: the sidebar against the left edge, the page (its
// content and its outline) across the rest. The docs are the one public section
// that fills the window rather than the site's centred column — a reference is
// read with the navigation and the outline in view, and both need the room.
export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-svh w-full bg-white text-zinc-900 lg:grid lg:grid-cols-[17rem_minmax(0,1fr)]">
      <DocsSidebar nav={DOCS_NAV} />
      <main className="min-w-0 px-6 py-8 lg:px-12 lg:py-12">{children}</main>
    </div>
  );
}
