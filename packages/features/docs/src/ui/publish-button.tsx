"use client";

import { api } from "@markbase/protocol/api-client";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, ChevronDown, Copy, Globe, Loader2 } from "lucide-react";
import { Button } from "@markbase/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@markbase/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@markbase/ui/dropdown-menu";
import { invalidateUrl } from "@markbase/ui/app-cache";

// Publishing a document to the web, in three parts the header composes: the
// state (`usePublish`), the "Publish" button that opens the dialog, and the
// dialog itself. They are separate because the header shows the button only
// when there is room — in a narrow document column the same action is an item
// in an overflow menu — and the state and the dialog must not live inside
// either trigger: a menu item unmounts with its menu the moment it is chosen.
//
// What is published is a VERSION, not the live text: the public page keeps
// showing the version that was chosen while the document goes on being
// edited. So the button is lime whenever there is something to publish —
// nothing public yet, or the document has moved on since the published
// version — and the dialog offers the versions to choose from, with a check
// beside the one that is live.

/** One version in the dialog's list. Mirrors the docs logic's VersionMeta. */
export interface PublishVersion {
  index: number;
  at: number;
  label?: string;
  author?: string;
}

export interface PublishStatus {
  published: boolean;
  url: string | null;
  /** The published version's index. Null when unpublished, or published before versions were pinned. */
  version?: number | null;
  /** The document has changed since the published version. */
  behind?: boolean;
  /** Every version, oldest first. Absent until the status has been fetched. */
  versions?: PublishVersion[];
}

/** Publish state and the things that change it. Owner-only. */
export interface PublishControl {
  status: PublishStatus;
  busy: boolean;
  /** Publish the text as it stands (no argument), or an existing version. */
  publish: (version?: number) => Promise<void>;
  unpublish: () => Promise<void>;
  /** Ask the server again — the document may have moved on. */
  refresh: () => Promise<void>;
  copy: (url: string) => Promise<void>;
}

/** How often a published document's "is it behind?" is asked again while it is open. */
const REFRESH_MS = 30_000;

/**
 * The caller keys the component that calls this by document id, so switching
 * documents remounts it with the right `initial` (the workspace payload — see
 * LoadedWorkspace.publish). The payload says only whether it is published;
 * which version, and whether the document has moved on, is asked once on
 * mount and again every so often while it is published — the button's colour
 * depends on it, and it changes as the person types.
 */
export function usePublish(docId: string, initial: PublishStatus): PublishControl {
  const [status, setStatus] = useState(initial);
  const [busy, setBusy] = useState(false);
  const url = `/api/v1/docs/${docId}/publish`;

  const refresh = useCallback(async () => {
    invalidateUrl(url);
    const res = await api.request(url).catch(() => null);
    if (!res || !res.ok) return;
    const d: PublishStatus = await res.json().catch(() => ({ published: false, url: null }));
    setStatus(d);
  }, [url]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!status.published) return;
    const timer = setInterval(() => void refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [status.published, refresh]);

  async function change(method: "POST" | "DELETE", version?: number): Promise<PublishStatus | null> {
    setBusy(true);
    try {
      const res = await api.request(url, {
        method,
        ...(method === "POST"
          ? {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(version === undefined ? {} : { version }),
            }
          : {}),
      });
      invalidateUrl(url); // we just changed it; the cached state is stale
      const d: PublishStatus & { error?: string } = await res
        .json()
        .catch(() => ({ published: false, url: null }));
      if (!res.ok) {
        toast.error(d.error ?? "Failed");
        return null;
      }
      setStatus(d);
      return d;
    } finally {
      setBusy(false);
    }
  }

  async function publish(version?: number) {
    const wasPublished = status.published;
    const d = await change("POST", version);
    if (!d) return;
    if (!wasPublished && d.url) {
      await navigator.clipboard.writeText(d.url).catch(() => {});
      toast.success("Published — public link copied");
    } else {
      toast.success(version === undefined ? "Published the latest version" : "Published that version");
    }
  }

  async function unpublish() {
    const d = await change("DELETE");
    if (d) toast.success("Unpublished");
  }

  async function copy(target: string) {
    try {
      await navigator.clipboard.writeText(target);
      toast.success("Copied");
    } catch {
      toast.error("Couldn't copy");
    }
  }

  return { status, busy, publish, unpublish, refresh, copy };
}

/** Is there something to publish — nothing public yet, or changes since the published version? */
export function hasUnpublishedChanges(status: PublishStatus): boolean {
  return !status.published || status.behind === true;
}

/** The "Publish" button for the doc header — lime whenever there is something to publish. */
export function PublishButton({
  publish,
  onClick,
}: {
  publish: PublishControl;
  /** Opens the PublishDialog the caller renders. */
  onClick: () => void;
}) {
  const pending = hasUnpublishedChanges(publish.status);
  return (
    <Button
      size="sm"
      variant={pending ? "default" : "outline"}
      onClick={onClick}
      className="h-7 gap-1.5 px-2.5 text-xs"
    >
      <Globe className="size-3.5" />
      {pending ? "Publish" : "Published"}
    </Button>
  );
}

function versionName(v: PublishVersion): string {
  const when = new Date(v.at).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return `Version ${v.index + 1} · ${when}`;
}

/** Choose which version is public: a dropdown, newest first, with a check beside the live one. */
function VersionPicker({ publish }: { publish: PublishControl }) {
  const { status, busy } = publish;
  const versions = [...(status.versions ?? [])].reverse();
  const live = versions.find((v) => v.index === status.version);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" disabled={busy} className="h-8 min-w-0 flex-1 justify-between font-normal">
          <span className="truncate">{live ? versionName(live) : "Choose a version"}</span>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-72 w-(--radix-dropdown-menu-trigger-width) overflow-y-auto">
        {status.behind && (
          <DropdownMenuItem onSelect={() => void publish.publish()}>
            <span className="size-4" />
            <span className="flex-1">Latest changes</span>
            <span className="text-xs text-muted-foreground">not published</span>
          </DropdownMenuItem>
        )}
        {versions.map((v) => (
          <DropdownMenuItem
            key={v.index}
            onSelect={() => {
              if (v.index !== status.version) void publish.publish(v.index);
            }}
          >
            {v.index === status.version ? <Check className="size-4" /> : <span className="size-4" />}
            <span className="flex-1 truncate">{versionName(v)}</span>
            {v.label && <span className="text-xs text-muted-foreground">{v.label}</span>}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Publish, choose the version that is public, copy the URL, unpublish. */
export function PublishDialog({
  open,
  onOpenChange,
  publish,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  publish: PublishControl;
}) {
  const { status, busy, copy, refresh } = publish;

  // The document may have moved on since the status was last asked.
  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Publish to web</DialogTitle>
          <DialogDescription>
            Turn this doc into a public page anyone can read — a clean URL built
            for search (Google) and AI answers (ChatGPT, Perplexity, Claude).
            The page shows the version you publish, and keeps showing it while
            you go on editing. Only you can publish or take it offline.
          </DialogDescription>
        </DialogHeader>

        {status.published && status.url ? (
          <div className="flex min-w-0 flex-col gap-3">
            <div className="flex h-8 min-w-0 items-center gap-1 rounded-lg border pr-1 pl-3 text-sm">
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

            <div className="flex min-w-0 items-center gap-2">
              <VersionPicker publish={publish} />
              <Button
                variant="outline"
                onClick={() => void publish.unpublish()}
                disabled={busy}
                className="h-8 shrink-0"
              >
                Unpublish
              </Button>
            </div>

            {status.behind ? (
              <Button onClick={() => void publish.publish()} disabled={busy} className="w-full">
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Globe className="size-4" />}
                Publish latest changes
              </Button>
            ) : (
              <p className="text-xs text-muted-foreground">
                {status.version === null || status.version === undefined
                  ? "The page follows the document as it is edited. Publish a version to pin it."
                  : "The page is up to date with the document."}
              </p>
            )}
            {(status.version === null || status.version === undefined) && !status.behind && (
              <Button variant="outline" onClick={() => void publish.publish()} disabled={busy} className="w-full">
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Globe className="size-4" />}
                Publish this version
              </Button>
            )}
          </div>
        ) : (
          <Button onClick={() => void publish.publish()} disabled={busy} className="w-full">
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
