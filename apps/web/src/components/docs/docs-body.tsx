import type { ReactNode } from "react";
import { CopyButton } from "@markbase/ui/copy-button";

// A docs page's content, under a row with the section it sits in and "Copy
// markdown", which puts the whole page's markdown on the clipboard — for an
// agent, an issue, another doc.
export function DocsBody({
  markdown,
  section,
  children,
}: {
  markdown: string;
  /** The sidebar section the page sits in, shown at the start of the row. */
  section: string;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <div className="mr-auto rounded-full bg-[#e5ff6e] px-2.5 py-0.5 text-xs font-semibold text-zinc-900">{section}</div>
        <CopyButton text={markdown} label="Copy markdown" />
      </div>
      {children}
    </div>
  );
}
