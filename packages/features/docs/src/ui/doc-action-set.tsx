"use client";

import { useState } from "react";
import { Bot, ChevronDown, Download, Globe, MoreHorizontal, Share2 } from "lucide-react";
import { docJsonToMarkdown, combineTabMarkdown, docFileSlug, getMarkdown } from "@markbase/docs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@markbase/ui/dropdown-menu";
import { cn } from "@markbase/ui/utils";
import { ComingSoonBadge } from "@markbase/ui/coming-soon";
import { DownloadDocButton, downloadMarkdown } from "./download-doc";
import { AGENTS, useAgentLauncher } from "./agent-launcher";
import { PublishButton, PublishDialog, usePublish } from "./publish-button";
import { useDocFetch } from "./doc-client";
import { docCrdtPool } from "./doc-crdt-pool";
import { useDocsPorts } from "./ports";
import type { TabDoc } from "./doc-view";

/**
 * The active document's actions — Share, Publish, Download — plus a
 * read-only/review hint. Lives over the content's top-right on the dashboard, or
 * inline on the guest page. The agent menu lives separately in the top-strip
 * header (see AgentMenu). Must render inside a DocClientProvider so the download
 * carries the right auth.
 *
 * Two renderings of one set of actions, and CSS picks which shows: the row of
 * labelled buttons, or — when the document column is narrower than 32rem — a
 * single "…" menu holding the same actions. DocView makes the column a
 * container; with the comments/history panel open on a small window it can be
 * ~350px, less than the view switcher plus three buttons, and the buttons used
 * to run out of the column and under the panel's heading. Outside a container
 * (the guest and file pages) the query is never true and the row shows. What
 * has state is shared: publish status and its dialog live here, above both, so
 * the rendering the user cannot see is still right when it becomes the one
 * they can — and because a menu item unmounts with its menu when chosen, the
 * dialog could not live inside it anyway.
 */
export function DocActionSet({
  isOwner,
  docId,
  tabDocs,
  title,
  editable,
  canComment,
  onOpenShare,
  isDesktop = false,
  publish: publishInitial = { published: false, url: null },
}: {
  isOwner: boolean;
  docId: string;
  /** Publish state from the workspace payload. Only the owner's button uses it. */
  publish?: { published: boolean; url: string | null };
  tabDocs: TabDoc[];
  title: string;
  editable: boolean;
  canComment: boolean;
  onOpenShare: () => void;
  /** On desktop the file already lives on disk (the vault syncs it), so the
   *  browser download is redundant and hidden. */
  isDesktop?: boolean;
}) {
  // Keyed by document id by the caller (DocView), so a new document starts
  // from its own payload rather than the previous one's toggled state.
  const publish = usePublish(docId, publishInitial);
  const [publishOpen, setPublishOpen] = useState(false);
  const collect = useWholeDocMarkdown(tabDocs);
  const filename = docFileSlug(title);
  const hint = editable ? null : canComment ? "Review" : "Read-only";
  const showDownload = !isDesktop;
  const anything = isOwner || showDownload || hint !== null;

  return (
    <>
      <div className="flex items-center gap-1.5 @max-[32rem]:hidden">
        {hint && <span className="mr-1 text-xs text-muted-foreground">{hint}</span>}
        {isOwner && (
          <button
            type="button"
            onClick={onOpenShare}
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Share2 className="size-3.5" />
            Share
          </button>
        )}
        {isOwner && <PublishButton publish={publish} onClick={() => setPublishOpen(true)} />}
        {showDownload && <DownloadDocButton filename={filename} getMarkdown={collect} />}
      </div>

      {anything && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Document actions"
              title="Document actions"
              className="hidden items-center rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground @max-[32rem]:inline-flex"
            >
              <MoreHorizontal className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-44">
            {hint && (
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                {hint}
              </DropdownMenuLabel>
            )}
            {isOwner && (
              <DropdownMenuItem onSelect={onOpenShare}>
                <Share2 className="size-4" />
                Share
              </DropdownMenuItem>
            )}
            {isOwner && (
              <DropdownMenuItem onSelect={() => setPublishOpen(true)}>
                <Globe className="size-4" />
                {publish.status.published ? "Published" : "Publish"}
              </DropdownMenuItem>
            )}
            {showDownload && (
              <DropdownMenuItem onSelect={() => void downloadMarkdown(filename, collect)}>
                <Download className="size-4" />
                Download
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {isOwner && (
        <PublishDialog open={publishOpen} onOpenChange={setPublishOpen} publish={publish} />
      )}
    </>
  );
}

/**
 * The "open this doc in an agent" menu — Claude Code opens the embedded right
 * panel (`onOpenAgentPanel`); every other agent launches externally in the
 * vault's folder. Rendered in the top-strip header beside the panel tabs. Hidden
 * when there's no launcher or vault (e.g. the guest page).
 */
export function AgentMenu({
  vaultId,
  docId,
  docPath,
  active = false,
  onOpenAgentPanel,
}: {
  /** The doc's vault — the context an opened agent works in. Absent hides the menu. */
  vaultId: string | null;
  docId: string;
  /** The doc's vault-relative file path, so an opened agent knows which file the
   *  user is viewing ("this document", "the images"). */
  docPath?: string | null;
  /** Highlight the trigger while the Claude Code panel is the open one. */
  active?: boolean;
  /** Open the right panel to the Claude Code tab (the native chat lives there). */
  onOpenAgentPanel?: () => void;
}) {
  const launcher = useAgentLauncher();
  if (!launcher || !vaultId) return null;
  const label =
    launcher.mode === "local"
      ? "Open in this vault's folder"
      : "Start a cloud agent on this doc";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Open in agent"
          title={label}
          className={cn(
            "inline-flex items-center gap-0.5 rounded-md p-1.5 transition-colors",
            active
              ? "bg-muted text-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          )}
        >
          <Bot className="size-4" />
          <ChevronDown className="size-3 opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-64">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          {label}
        </DropdownMenuLabel>
        {AGENTS.map((a) => (
          <DropdownMenuItem
            key={a.id}
            disabled={a.comingSoon || !launcher.available(a.id)}
            onSelect={() =>
              a.id === "claude-code"
                ? onOpenAgentPanel?.()
                : launcher.open(a.id, { vaultId, docId, docPath: docPath ?? undefined })
            }
          >
            <a.icon className="size-4" />
            {a.name}
            {a.comingSoon && <ComingSoonBadge className="ml-auto" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// The whole logical document (all tabs) as one Markdown file, for the download.
//
// A tab the editor has open is read from the warm pool: its Y.Doc is the text on
// screen, edits and all, and it is there whether or not there is a network — the
// desktop's file window has no API at all. A tab nothing has opened is fetched,
// and falls back to the loaded snapshot if that fails.
function useWholeDocMarkdown(tabDocs: TabDoc[]): () => Promise<string> {
  const docFetch = useDocFetch();
  const ports = useDocsPorts();

  return async function collect(): Promise<string> {
    const pool = docCrdtPool(ports);
    const parts = await Promise.all(
      tabDocs.map(async (t) => {
        const open = pool.join(t.id);
        if (open) {
          try {
            return getMarkdown((await open).doc);
          } finally {
            pool.release(t.id);
          }
        }
        try {
          const res = await docFetch(`/api/v1/docs/${t.id}`);
          if (res.ok) {
            const data: { doc?: { content?: string } } = await res.json();
            if (typeof data.doc?.content === "string") return data.doc.content;
          }
        } catch {
          // network error — fall back to the version we loaded with
        }
        return docJsonToMarkdown(t.doc_json);
      })
    );
    return combineTabMarkdown(parts);
  };
}
