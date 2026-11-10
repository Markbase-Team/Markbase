"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { markdownToDoc, type DocJSON } from "@markbase/docs";
import { AppHeader, headerNoDrag } from "@markbase/ui/app-header";
import { cn } from "@markbase/ui/utils";
import { DocView, ViewModeSwitcher, type DocViewMode, type TabDoc } from "./doc-view";
import { DocActionSet } from "./doc-action-set";
import { DocClientProvider } from "./doc-client";
import { docCrdtPool } from "./doc-crdt-pool";
import { LocalFileSession, localDocId, type LocalFileState } from "./local-file-crdt";
import { useDocsPorts, type LocalFile } from "./ports";

// A markdown file on disk, as a standalone full-height page — the desktop's
// window for a `.md` that is not inside any vault.
//
// The same DocView and DocActionSet as the dashboard and the share page, minus
// everything that needs an account or a network: no vault sidebar, no tabs, no
// share, publish, comments or history. The document is backed by a file rather
// than a cloud CRDT (see local-file-crdt.ts), and this page draws what that
// backing has to say — the save that failed, the edit made elsewhere — in a
// strip under the header, never in a console.

// Includes "claude" to match DocView's panel; there is no vault here, so the
// Claude Code tab is never shown — this only keeps the prop types aligned.
type PanelTab = "tabs" | "comments" | "history" | "claude";

const MARKDOWN_EXT = /\.(md|markdown|mdown|mkd)$/i;

export function LocalFileDoc({ file }: { file: LocalFile }) {
  if (file.error) {
    return (
      <Frame file={file}>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <main className="mx-auto w-full max-w-3xl px-6 py-8">
            <Problem title="This file couldn't be opened" detail={file.error} path={file.path} />
          </main>
        </div>
      </Frame>
    );
  }
  return <LocalFileEditor file={file} />;
}

function LocalFileEditor({ file }: { file: LocalFile }) {
  const docId = localDocId(file.path);
  const title = file.name.replace(MARKDOWN_EXT, "");
  // One tab: the file. Its content is both the editor's first paint and the
  // seed the pool opens the Y.Doc from — for a file they are the same thing.
  const tabDocs = useMemo<TabDoc[]>(
    () => [
      {
        id: docId,
        title,
        doc_json: markdownToDoc(file.content).toJSON() as DocJSON,
        version: 0,
        seedMarkdown: file.content,
      },
    ],
    [docId, title, file.content]
  );
  const { session, error: openError } = useLocalFileSession(docId, file.content);
  const state = useLocalFileState(session);
  const [viewMode, setViewMode] = useState<DocViewMode>("preview");
  const [panelTab, setPanelTab] = useState<PanelTab>("comments");

  return (
    <DocClientProvider docId={docId}>
      <Frame
        file={file}
        actions={
          <>
            <ViewModeSwitcher
              mode={viewMode}
              onPreview={() => setViewMode("preview")}
              onMarkdown={() => setViewMode("markdown")}
            />
            <DocActionSet
              isOwner={false}
              docId={docId}
              tabDocs={tabDocs}
              title={title}
              editable
              canComment={false}
              onOpenShare={() => {}}
            />
          </>
        }
      >
        {openError && (
          <Notice tone="error">
            <span className="min-w-0 flex-1">Couldn't open this file for editing: {openError}</span>
          </Notice>
        )}
        {file.watchError && (
          <Notice tone="warn">
            <span className="min-w-0 flex-1">{file.watchError}</span>
          </Notice>
        )}
        {session && <FileNotices session={session} state={state} />}
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <DocView
            docId={docId}
            capability="owner"
            tabDocs={tabDocs}
            panelOpen={false}
            panelTab={panelTab}
            onPanelTabChange={setPanelTab}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
          />
        </div>
      </Frame>
    </DocClientProvider>
  );
}

/**
 * Open the file's Y.Doc and hold it for the page's lifetime.
 *
 * The page acquires first, before any editor does, because it is the one that
 * knows this id is a file: the entry it gets back carries the LocalFileSession,
 * which is where the unsaved/external state lives. The editors that mount
 * below join the same warm entry. Holding the reference also keeps the pool
 * from ever letting the session go while the window is open.
 */
function useLocalFileSession(
  docId: string,
  markdown: string
): { session: LocalFileSession | null; error: string | null } {
  const [session, setSession] = useState<LocalFileSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ports = useDocsPorts();
  useEffect(() => {
    let disposed = false;
    const pool = docCrdtPool(ports);
    pool.acquire(docId, markdown).then(
      (entry) => {
        if (disposed) return;
        if (entry.session instanceof LocalFileSession) setSession(entry.session);
        else setError("This document is not backed by a file.");
      },
      (e: Error) => {
        if (!disposed) setError(e instanceof Error ? e.message : String(e));
      }
    );
    return () => {
      disposed = true;
      setSession(null);
      pool.release(docId);
    };
    // The markdown is only the seed for the first open of this id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, ports]);
  return { session, error };
}

const IDLE: LocalFileState = { dirty: false, saveError: null, external: null, fileError: null };

function useLocalFileState(session: LocalFileSession | null): LocalFileState {
  return useSyncExternalStore(
    (cb) => (session ? session.subscribe(cb) : () => {}),
    () => (session ? session.getState() : IDLE),
    () => IDLE
  );
}

/** What the file has to say, under the header. Nothing, most of the time. */
function FileNotices({ session, state }: { session: LocalFileSession; state: LocalFileState }) {
  return (
    <>
      {state.external && (
        <Notice tone="warn">
          <span className="min-w-0 flex-1">
            This file changed on disk while you had unsaved edits. Saving is paused until you choose.
          </span>
          <NoticeButton onClick={() => session.reloadFromDisk()}>
            <RefreshCw className="size-3.5" />
            Reload from disk
          </NoticeButton>
          <NoticeButton onClick={() => session.keepMine()}>Keep my edits</NoticeButton>
        </Notice>
      )}
      {state.saveError && (
        <Notice tone="error">
          <span className="min-w-0 flex-1">Couldn't save: {state.saveError}</span>
          <NoticeButton onClick={() => void session.flush()}>
            <RefreshCw className="size-3.5" />
            Retry
          </NoticeButton>
        </Notice>
      )}
      {state.fileError && (
        <Notice tone="warn">
          <span className="min-w-0 flex-1">
            The file can't be read from disk any more: {state.fileError} Your next edit writes it
            back to the same path.
          </span>
        </Notice>
      )}
    </>
  );
}

/** The window: the file's name and folder on the title row, then the content. */
function Frame({
  file,
  actions,
  children,
}: {
  file: LocalFile;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-svh w-full min-w-0 flex-col">
      {/* AppHeader spans the web shell's icon rail by hanging 3rem off its own
          left edge. There is no rail in this window, so it is pinned back to the
          edge rather than the whole page being inset to make room. */}
      <AppHeader title={file.name} className="ml-0 w-full">
        <span className="min-w-0 truncate text-xs text-muted-foreground" title={file.path}>
          {file.dir}
        </span>
        {actions && (
          <div className={cn("ml-auto flex shrink-0 items-center gap-2", headerNoDrag)}>{actions}</div>
        )}
      </AppHeader>
      {children}
    </div>
  );
}

function Notice({ tone, children }: { tone: "warn" | "error"; children: React.ReactNode }) {
  return (
    <div
      role="status"
      className={cn(
        "flex shrink-0 items-center gap-3 border-b px-4 py-2 text-xs",
        tone === "error"
          ? "bg-destructive/10 text-destructive"
          : "bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-300"
      )}
    >
      <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
      {children}
    </div>
  );
}

function NoticeButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-current/30 px-2 py-1 font-medium hover:bg-background/60"
    >
      {children}
    </button>
  );
}

function Problem({ title, detail, path }: { title: string; detail: string; path: string }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{detail}</p>
      <p className="mt-3 font-mono text-xs break-all text-muted-foreground">{path}</p>
    </div>
  );
}
