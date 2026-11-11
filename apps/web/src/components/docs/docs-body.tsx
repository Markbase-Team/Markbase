"use client";

import { useState, type ReactNode } from "react";
import { CopyButton } from "@markbase/ui/copy-button";

// A docs page's content, shown rendered by default, with its markdown one click
// away: "Copy markdown" puts the whole page on the clipboard (for an agent, an
// issue, another doc), and "Markdown" shows the source in place. The rendered
// page arrives as `children` from the server; only the switch is client-side.
export function DocsBody({
  markdown,
  section,
  children,
}: {
  markdown: string;
  /** The sidebar section the page sits in, shown at the start of the toolbar row. */
  section: string;
  children: ReactNode;
}) {
  const [view, setView] = useState<"page" | "markdown">("page");
  const tab = (v: "page" | "markdown", label: string) => (
    <button
      type="button"
      onClick={() => setView(v)}
      aria-pressed={view === v}
      className={
        view === v
          ? "rounded-md bg-white px-2.5 py-1 text-xs font-medium text-zinc-900 shadow-sm"
          : "rounded-md px-2.5 py-1 text-xs font-medium text-zinc-500 hover:text-zinc-900"
      }
    >
      {label}
    </button>
  );
  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <div className="mr-auto text-sm font-medium text-zinc-500">{section}</div>
        <div className="inline-flex rounded-lg bg-zinc-100 p-0.5" role="group" aria-label="View">
          {tab("page", "Page")}
          {tab("markdown", "Markdown")}
        </div>
        <CopyButton text={markdown} label="Copy markdown" />
      </div>
      {view === "page" ? (
        children
      ) : (
        <pre className="overflow-x-auto rounded-lg border border-zinc-200 bg-zinc-50 p-4 font-mono text-[13px] leading-relaxed whitespace-pre text-zinc-800">
          {markdown}
        </pre>
      )}
    </div>
  );
}
