"use client";

import * as React from "react";
import { Letter } from "react-letter";
import { Loader2 } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./dialog";
import { Markdown } from "./markdown";
import { cn } from "./utils";

// A reusable, format-aware reader modal. Today it renders email (HTML via
// react-letter, with a plain-text fallback), raw html, plain text, and
// markdown. Add new `kind`s to ReaderSource + the switch below as more format
// readers are needed (PDF, images, …) — callers don't change.

export type ReaderSource =
  | { kind: "email"; html?: string | null; text?: string | null }
  | { kind: "html"; html: string }
  | { kind: "text"; text: string }
  | { kind: "markdown"; markdown: string };

function Reader({ source }: { source: ReaderSource }) {
  switch (source.kind) {
    case "email":
      return source.html ? (
        <Letter
          html={source.html}
          className="text-sm [&_a]:text-blue-600 [&_img]:max-w-full"
        />
      ) : (
        <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">
          {source.text || "(no content)"}
        </div>
      );
    case "html":
      return (
        <Letter
          html={source.html}
          className="text-sm [&_a]:text-blue-600 [&_img]:max-w-full"
        />
      );
    case "text":
      return (
        <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">
          {source.text || "(no content)"}
        </div>
      );
    case "markdown":
      return <Markdown content={source.markdown} />;
  }
}

export function ReaderModal({
  open,
  onOpenChange,
  title,
  meta,
  source,
  loading = false,
  actions,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: React.ReactNode;
  meta?: React.ReactNode; // sub-line under the title (sender, date, …)
  source: ReaderSource | null;
  loading?: boolean;
  actions?: React.ReactNode; // footer affordances (e.g. "Open in Gmail")
  className?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-2xl",
          className
        )}
      >
        <DialogHeader className="border-b p-4">
          <DialogTitle className="pr-8">{title ?? "(no subject)"}</DialogTitle>
          {meta && (
            <DialogDescription className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {meta}
            </DialogDescription>
          )}
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex h-40 items-center justify-center text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : source ? (
            <Reader source={source} />
          ) : (
            <p className="text-sm text-muted-foreground">Nothing to show.</p>
          )}
        </div>

        {actions && (
          <div className="flex items-center justify-end gap-2 border-t p-3">
            {actions}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
