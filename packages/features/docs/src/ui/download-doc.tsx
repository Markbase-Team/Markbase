"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { cn } from "@markbase/ui/utils";

/**
 * Save `getMarkdown()`'s text as `<filename>.md` through the browser's own
 * download. The caller supplies `getMarkdown` (sync or async) so each surface
 * produces the file body its own way — e.g. the workspace fetches the latest
 * content per tab. The button below and the header's overflow menu both use it.
 */
export async function downloadMarkdown(
  filename: string,
  getMarkdown: () => string | Promise<string>
): Promise<void> {
  const markdown = await getMarkdown();
  const blob = new Blob([markdown], {
    type: "text/markdown;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".md") ? filename : `${filename}.md`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// A "Download .md" control that triggers a client-side file download.
export function DownloadDocButton({
  filename,
  getMarkdown,
  className,
  label = "Download",
}: {
  filename: string;
  getMarkdown: () => string | Promise<string>;
  className?: string;
  label?: string;
}) {
  const [busy, setBusy] = useState(false);

  async function onClick() {
    if (busy) return;
    setBusy(true);
    try {
      await downloadMarkdown(filename, getMarkdown);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-label="Download as Markdown"
      title="Download as Markdown"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50",
        className
      )}
    >
      <Download className="size-3.5" />
      {label}
    </button>
  );
}
