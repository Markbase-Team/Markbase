"use client";

import { api } from "@markbase/protocol/api-client";
import { useState } from "react";
import { toast } from "sonner";
import { Copy, Globe, Loader2 } from "lucide-react";
import { Button } from "@markbase/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@markbase/ui/dialog";
import { invalidateUrl } from "@markbase/ui/app-cache";

// Publishing a document to the web, in three parts the header composes: the
// state (`usePublish`), the lime "Publish" button that opens the dialog, and
// the dialog itself. They are separate because the header shows the button
// only when there is room — in a narrow document column the same action is an
// item in an overflow menu — and the state and the dialog must not live inside
// either trigger: a menu item unmounts with its menu the moment it is chosen.

export interface PublishStatus {
  published: boolean;
  url: string | null;
}

/** Publish state and the two things that change it. Owner-only. */
export interface PublishControl {
  status: PublishStatus;
  busy: boolean;
  toggle: () => Promise<void>;
  copy: (url: string) => Promise<void>;
}

/**
 * No fetch on mount, and no effect to resync: the caller keys the component
 * that calls this by document id, so switching documents remounts it with the
 * right `initial` (the workspace payload — see LoadedWorkspace.publish).
 */
export function usePublish(docId: string, initial: PublishStatus): PublishControl {
  const [status, setStatus] = useState(initial);
  const [busy, setBusy] = useState(false);
  const url = `/api/v1/docs/${docId}/publish`;

  async function toggle() {
    setBusy(true);
    try {
      const res = await api.request(url, {
        method: status.published ? "DELETE" : "POST",
      });
      invalidateUrl(url); // we just changed it; the cached state is stale
      const d: { published?: boolean; url?: string | null; error?: string } =
        await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(d.error ?? "Failed");
        return;
      }
      setStatus({ published: Boolean(d.published), url: d.url ?? null });
      if (d.published && d.url) {
        await navigator.clipboard.writeText(d.url).catch(() => {});
        toast.success("Published — public link copied");
      } else {
        toast.success("Unpublished");
      }
    } finally {
      setBusy(false);
    }
  }

  async function copy(target: string) {
    try {
      await navigator.clipboard.writeText(target);
      toast.success("Copied");
    } catch {
      toast.error("Couldn't copy");
    }
  }

  return { status, busy, toggle, copy };
}

/** The primary (lime) "Publish" button for the doc header — sits next to Share. */
export function PublishButton({
  publish,
  onClick,
}: {
  publish: PublishControl;
  /** Opens the PublishDialog the caller renders. */
  onClick: () => void;
}) {
  return (
    <Button
      size="sm"
      variant={publish.status.published ? "outline" : "default"}
      onClick={onClick}
      className="h-7 gap-1.5 px-2.5 text-xs"
    >
      <Globe className="size-3.5" />
      {publish.status.published ? "Published" : "Publish"}
    </Button>
  );
}

/** Publish/unpublish and copy the public URL. */
export function PublishDialog({
  open,
  onOpenChange,
  publish,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  publish: PublishControl;
}) {
  const { status, busy, toggle, copy } = publish;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Publish to web</DialogTitle>
          <DialogDescription>
            Turn this doc into a public page anyone can read — a clean URL built
            for search (Google) and AI answers (ChatGPT, Perplexity, Claude).
            Only you can publish or take it offline.
          </DialogDescription>
        </DialogHeader>

        {status.published && status.url ? (
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex h-8 min-w-0 flex-1 items-center gap-1 rounded-lg border pr-1 pl-3 text-sm">
              <a
                href={status.url}
                target="_blank"
                rel="noreferrer"
                className="min-w-0 flex-1 truncate text-muted-foreground hover:text-foreground hover:underline"
              >
                {status.url}
              </a>
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={() => copy(status.url!)}
                aria-label="Copy public link"
              >
                <Copy className="size-3.5" />
              </Button>
            </div>
            <Button
              variant="outline"
              onClick={toggle}
              disabled={busy}
              className="h-8 shrink-0"
            >
              {busy && <Loader2 className="size-4 animate-spin" />}
              Unpublish
            </Button>
          </div>
        ) : (
          <Button onClick={toggle} disabled={busy} className="w-full">
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Globe className="size-4" />
            )}
            Publish to web
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}
