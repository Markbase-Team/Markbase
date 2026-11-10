"use client";

import { FileText, X } from "lucide-react";
import { cn } from "@markbase/ui/utils";

// Render one uploaded attachment URL: an image as a clickable thumbnail, or a
// PDF (detected by extension) as a labeled file tile. Optional remove button.
export function AttachmentThumb({
  url,
  onRemove,
  className = "size-16",
}: {
  url: string;
  onRemove?: () => void;
  className?: string;
}) {
  const isPdf = /\.pdf(?:$|\?)/i.test(url);
  return (
    <div className="relative">
      {isPdf ? (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className={cn(
            "flex flex-col items-center justify-center gap-1 rounded-md border bg-muted/40 p-1 text-center transition-colors hover:bg-muted",
            className
          )}
        >
          <FileText className="size-5 text-muted-foreground" />
          <span className="text-[9px] font-medium text-muted-foreground">PDF</span>
        </a>
      ) : (
        <a href={url} target="_blank" rel="noreferrer">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt="attachment"
            className={cn(
              "rounded-md border object-cover transition-opacity hover:opacity-80",
              className
            )}
          />
        </a>
      )}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="absolute -top-1.5 -right-1.5 rounded-full border bg-background p-0.5 text-muted-foreground hover:text-foreground"
          aria-label="Remove attachment"
        >
          <X className="size-3" />
        </button>
      )}
    </div>
  );
}
