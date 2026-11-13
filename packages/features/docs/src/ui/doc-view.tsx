"use client";

import { api } from "@markbase/protocol/api-client";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { useDocsPorts } from "./ports";
import { CachedCopyBadge, useCachedCopy } from "./use-cached-copy";
import { ChartColumn, ChevronDown, ChevronUp, Clock, Code2, Eye, MessageSquare, Search, X } from "lucide-react";
import { ClaudeMark } from "./claude-mark";
import {
  getMarkdown,
  setMarkdown,
  observeMarkdown,
  type DocJSON,
} from "@markbase/docs";
import { docCrdtPool, type CrdtEntry } from "./doc-crdt-pool";
import { isLocalDocId } from "./local-file-crdt";
import { DocMarkdownEditor } from "./doc-markdown-editor";
import type { Capability } from "@markbase/docs/server";
import { cn } from "@markbase/ui/utils";
import type { OpenIntent } from "@markbase/docs/workspace-tabs";
import {
  DocEditor,
  type EditorSelection,
  type DocEditorHandle,
  type SearchStatus,
} from "./doc-editor";
import { DocHistory } from "./doc-history";
import { VersionPreview } from "./version-preview";
import { useDocVersions } from "./use-doc-versions";
import { CommentsPanel } from "./comments-panel";
import { DocAnalytics } from "./doc-analytics";
import { AgentChatDock } from "./agent-chat-dock";
import { DocActionSet } from "./doc-action-set";
import { LocalForkBanner } from "./local-fork-banner";
import { invalidateDocLists } from "./doc-list-fetch";
import { DEFAULT_PANEL_WIDTH, savedPanelWidth, startPanelDrag } from "./panel-width";
import { useClientValue } from "./client-value";
import { submitKeys } from "@markbase/ui/keys";

export type TabDoc = {
  id: string;
  title: string;
  doc_json: DocJSON;
  version: number;
  /** Seed for a doc with no cloud CRDT yet — NOT the content to display. */
  seedMarkdown: string;
};


type PanelTab = "analytics" | "comments" | "history" | "claude";

/** The rendered editor, or the raw markdown it is derived from. */
export type DocViewMode = "preview" | "markdown";

/**
 * The editing surface for ONE document: its subtabs stacked in one scroll
 * (center), the analytics/comments/history panel (right column), and find-in-doc.
 * Presentational — `panelOpen` is owned by the caller so the right column can be
 * toggled from the shared top-row chrome (see DocChrome). Reused by the dashboard
 * workspace and the guest share page.
 *
 * The same instance is reused as you switch open docs, so it resets its per-doc
 * view state when `docId` changes and rebinds its editors to the new doc's warm
 * Y.Doc rather than remounting.
 */
export function DocView({
  docId,
  vaultId,
  docPath,
  capability,
  tabDocs,
  shareToken,
  userName,
  userId,
  panelOpen,
  panelTab,
  onPanelTabChange,
  panelWidth: controlledPanelWidth,
  onPanelWidthChange,
  onOpenWikiLink,
  agentHosted = false,
  onAgentSelection,
  onOpenShare,
  isDesktop = false,
  chromeInHeader = false,
  publish = { published: false, url: null },
  viewMode: controlledViewMode,
  onViewModeChange,
}: {
  docId: string;
  vaultId?: string | null;
  /** The doc's vault-relative file path — context for the embedded agent chat. */
  docPath?: string | null;
  capability: Capability;
  tabDocs: TabDoc[];
  shareToken?: string;
  userName?: string;
  userId?: string | null;
  panelOpen: boolean;
  panelTab: PanelTab;
  onPanelTabChange: (tab: PanelTab) => void;
  /** The panel column width, lifted to the workspace so its top-strip tab bar can
   *  match — controlled when provided, otherwise DocView owns it (guest page). */
  panelWidth?: number;
  onPanelWidthChange?: (width: number) => void;
  /** Open the Share dialog (owned by the workspace). Enables the doc's Share/Publish
   *  actions in the content's top-right when `chromeInHeader`. */
  onOpenShare?: () => void;
  isDesktop?: boolean;
  /** The workspace hosts the panel tabs in its top strip, so this DocView drops the
   *  aside's tab bar and shows the doc actions (Share/Publish/…) over the content. */
  chromeInHeader?: boolean;
  /** Publish state, already in the workspace payload — saves the button a request. */
  publish?: { published: boolean; url: string | null };
  /** Follow a `[[wiki-link]]` to another doc in the vault — here, or in a new tab. */
  onOpenWikiLink?: (target: string, intent: OpenIntent) => void;
  /** The workspace draws one agent panel beside every document, so with the
   *  Claude tab showing this document gives up its right-hand column (see
   *  DocsWorkspace). The guest page, which has no workspace, leaves this off and
   *  gets the panel inline. */
  agentHosted?: boolean;
  /** Report this document's selection to the hosted agent panel. */
  onAgentSelection?: (docId: string, sel: EditorSelection | null) => void;
  /** Preview or raw markdown — controlled when a caller draws the switcher in
   *  its own chrome (the desktop's file window); otherwise DocView owns it. */
  viewMode?: DocViewMode;
  onViewModeChange?: (mode: DocViewMode) => void;
}) {
  // The agent chat's file links: ⌘/Ctrl-click opens them in a new tab.
  const openAgentFile = useCallback(
    (path: string, opts?: { newTab: boolean }) =>
      onOpenWikiLink?.(path, opts?.newTab ? "new" : "current"),
    [onOpenWikiLink]
  );
  // Desktop serves this document from a local snapshot and refreshes behind the
  // answer, so the text on screen can briefly be out of date — and stays out of
  // date, silently, if that refresh fails. Say so.
  const cachedCopy = useCachedCopy(docId);
  const editable = capability === "owner" || capability === "editor";
  const canComment = editable || capability === "commenter";
  const isGuest = Boolean(shareToken);

  /**
   * Open the agent panel — connecting Claude first, if it isn't yet.
   *
   * This is the moment the app first NEEDS Claude, so it's the moment to ask. On
   * the desktop the shell answers `ready:false` and raises its own sign-in window;
   * we leave the panel shut so the user isn't looking at a chat box that cannot
   * answer them. On the web there is no agent port and this is a plain tab
   * switch, exactly as before.
   */
  const ports = useDocsPorts();
  const openClaudePanel = async (): Promise<void> => {
    if (ports.agent) {
      const { ready } = await ports.agent.ensureReady();
      if (!ready) return;
    }
    onPanelTabChange("claude");
  };

  // Which version is open in the main area (CRDT history), or null while editing.
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [activeTabId, setActiveTabId] = useState(docId);
  // Live tab titles, seeded from the server render and updated in realtime as
  // each tab's title changes (locally or via another client).
  const [titles, setTitles] = useState<Record<string, string>>(() =>
    Object.fromEntries(tabDocs.map((t) => [t.id, t.title]))
  );

  // An UNTITLED doc takes its name from the first heading you type — persisted
  // (debounced) so the server makes the file follow (path-follows-title). Once it
  // has a name, this stops: naming is a one-time courtesy for a document that has
  // none, not a standing link between the body and the filename. Renaming a named
  // document is explicit (the pencil in the vault tree).
  //
  // What reaches here is a LEADING h1 the person typed: a title the document
  // declares in frontmatter is dropped at the call site, a heading further down
  // is a section (titleOf), and content that arrived from elsewhere is applied
  // without an update event (use-crdt-sync). That is what lets the heading name
  // the document outright — the guard that limited this to untitled documents
  // dated from when any heading, anywhere, could rename a file, and from when a
  // rename on disk could fork the document (the daemon pairs renames by inode
  // now, and moves a file in place instead of through .trash).
  //
  // persistedTitles is the title the server has, so the same one is never
  // PATCHed twice — including after a rename made in the sidebar.
  const persistedTitles = useRef<Record<string, string>>({});
  const renameTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  useEffect(() => {
    for (const t of tabDocs) persistedTitles.current[t.id] = t.title;
  }, [tabDocs]);
  useEffect(
    () => () => {
      for (const id of Object.keys(renameTimers.current)) clearTimeout(renameTimers.current[id]);
    },
    []
  );
  const scheduleRename = useCallback(
    (tabId: string, title: string) => {
      // A file on disk is named by its filename; there is no row to rename.
      if (!editable || isLocalDocId(tabId)) return;
      const trimmed = title.trim();
      if (!trimmed || persistedTitles.current[tabId] === trimmed) return;
      clearTimeout(renameTimers.current[tabId]);
      renameTimers.current[tabId] = setTimeout(() => {
        if (persistedTitles.current[tabId] === trimmed) return;
        persistedTitles.current[tabId] = trimmed;
        void api.request(`/api/v1/docs/${tabId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: trimmed }),
        })
          // The title (and the path that follows it) just changed — the cached
          // document lists still carry the old one.
          .then(() => invalidateDocLists())
          .catch(() => {});
      }, 1500);
    },
    [editable]
  );
  const [selection, setSelection] = useState<{
    tabId: string;
    sel: EditorSelection;
  } | null>(null);

  // The main area shows either the rendered editor ("preview") or an editable raw
  // markdown source ("markdown"). Markdown mode edits the SAME CRDT (the Y.Doc's
  // markdown is the source of truth), so changes flow to the editor and the cloud.
  const [localViewMode, setLocalViewMode] = useState<DocViewMode>("preview");
  const viewMode = controlledViewMode ?? localViewMode;
  const setViewMode = onViewModeChange ?? setLocalViewMode;

  // The right panel is drag-resizable (min 280 / max 900 px); the width persists.
  // Controlled by the workspace when it hosts the panel tabs (so its top-strip tab
  // bar matches this width); otherwise (guest page) DocView owns it locally.
  const gridRef = useRef<HTMLDivElement>(null);
  // Uncontrolled (the guest page) reads the stored width through useClientValue,
  // so the server renders the default and the browser corrects it at hydration
  // rather than an effect doing it a commit later. Controlled, the workspace owns
  // it and this is unused.
  const storedPanelWidth = useClientValue(savedPanelWidth, DEFAULT_PANEL_WIDTH);
  const [draggedPanelWidth, setLocalPanelWidth] = useState<number | null>(null);
  const localPanelWidth = draggedPanelWidth ?? storedPanelWidth;
  const panelWidth = controlledPanelWidth ?? localPanelWidth;
  const applyPanelWidth = onPanelWidthChange ?? setLocalPanelWidth;
  const startPanelResize = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      const grid = gridRef.current;
      if (!grid) return;
      startPanelDrag({
        rightEdge: grid.getBoundingClientRect().right,
        // The node carrying `--doc-panel-w`; absent on the guest page, which has
        // no workspace around it and one document to render.
        host: grid.closest<HTMLElement>("[data-doc-workspace]"),
        start: panelWidth,
        apply: applyPanelWidth,
      });
    },
    [panelWidth, applyPanelWidth]
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Map<string, HTMLElement>>(new Map());
  // Each tab's editor handle, so clicking a comment can scroll its editor to the
  // quoted text.
  const editorHandles = useRef<Map<string, DocEditorHandle>>(new Map());

  // Find-in-document (Cmd+F). The bar drives the ACTIVE subtab's editor.
  const rootRef = useRef<HTMLElement>(null);
  const findInputRef = useRef<HTMLInputElement>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [findTerm, setFindTerm] = useState("");
  const [findStatus, setFindStatus] = useState<SearchStatus>({ count: 0, index: 0 });

  // This surface is REUSED as you switch open docs (it isn't keyed by doc, so
  // editors rebind rather than remount — the warm-pool win). So when docId flips,
  // reset the per-doc view state that would otherwise carry over.
  const prevDocId = useRef(docId);
  useEffect(() => {
    if (prevDocId.current === docId) return;
    prevDocId.current = docId;
    setActiveTabId(docId);
    setPreviewIndex(null);
    setViewMode("preview");
    setSelection(null);
    setTitles(Object.fromEntries(tabDocs.map((t) => [t.id, t.title])));
    setFindOpen(false);
    setFindTerm("");
    scrollRef.current?.scrollTo(0, 0);
  }, [docId, tabDocs]);

  // Cmd/Ctrl+F opens the find bar.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && (e.key === "f" || e.key === "F")) {
        if (!rootRef.current || rootRef.current.offsetParent === null) return;
        e.preventDefault();
        setFindOpen(true);
        window.setTimeout(() => findInputRef.current?.select(), 0);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // (Re)apply the search to the active subtab's editor as the term or active
  // subtab changes while the bar is open.
  useEffect(() => {
    if (!findOpen) return;
    const h = editorHandles.current.get(activeTabId);
    if (!h) return;
    if (findTerm) {
      setFindStatus(h.search(findTerm));
    } else {
      h.clearSearch();
      setFindStatus({ count: 0, index: 0 });
    }
  }, [findTerm, findOpen, activeTabId]);

  function closeFind() {
    editorHandles.current.forEach((h) => h.clearSearch());
    setFindOpen(false);
  }

  // Clicking a comment (in the active tab's panel) jumps the editor to its quote.
  function focusComment(quote: string) {
    editorHandles.current.get(activeTabId)?.scrollToQuote(quote);
  }

  // Scroll-spy: the current tab is the last section whose top has reached the
  // top of the scroll area.
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const onScroll = () => {
      const rootTop = root.getBoundingClientRect().top;
      let current = tabDocs[0]?.id ?? docId;
      for (const t of tabDocs) {
        const el = sectionRefs.current.get(t.id);
        if (el && el.getBoundingClientRect().top - rootTop <= 96) current = t.id;
      }
      setActiveTabId((prev) => (prev === current ? prev : current));
    };
    root.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => root.removeEventListener("scroll", onScroll);
  }, [tabDocs, docId]);

  function onTabSelection(tabId: string, sel: EditorSelection | null) {
    // Track the selection so a manually-opened Comments panel can anchor to it,
    // but DON'T auto-open the panel on selection — that's intrusive while editing.
    if (sel) {
      setActiveTabId(tabId);
      setSelection({ tabId, sel });
    } else if (selection?.tabId === tabId) {
      setSelection(null);
    }
  }

  const panelSelection = selection?.tabId === activeTabId ? selection.sel : null;

  // The hosted agent panel is shared between documents; it offers the ACTIVE
  // document's selection to the agent, so each document says what it has.
  useEffect(() => {
    onAgentSelection?.(docId, panelSelection);
  }, [onAgentSelection, docId, panelSelection]);

  // The right-hand column. In the workspace the Claude tab isn't in it: the
  // workspace draws that panel beside every document, so the document gives up
  // its column rather than showing an empty one.
  const showAside = panelOpen && !(agentHosted && panelTab === "claude");

  return (
    <main ref={rootRef} className="relative flex h-full w-full min-w-0">
      {findOpen && (
        <div className="absolute top-3 right-4 z-30 flex items-center gap-1 rounded-lg border bg-background px-2 py-1 shadow-lg">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            ref={findInputRef}
            value={findTerm}
            onChange={(e) => setFindTerm(e.target.value)}
            // Shift+Enter is find-PREVIOUS here, which is why onSubmit takes it.
            // submitKeys BUILDS the handler; the ref it reads is only touched
            // once a key is pressed.
            // eslint-disable-next-line react-hooks/refs
            onKeyDown={submitKeys({
              onSubmit: (shift) => {
                const h = editorHandles.current.get(activeTabId);
                if (h) setFindStatus(shift ? h.findPrev() : h.findNext());
              },
              onEscape: closeFind,
            })}
            placeholder="Find in document"
            className="w-40 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <span className="min-w-[3.5ch] text-right text-xs text-muted-foreground tabular-nums">
            {findTerm ? `${findStatus.index}/${findStatus.count}` : ""}
          </span>
          <div className="mx-0.5 h-4 w-px bg-border" />
          <button
            type="button"
            aria-label="Previous match"
            onClick={() => {
              const h = editorHandles.current.get(activeTabId);
              if (h) setFindStatus(h.findPrev());
            }}
            disabled={findStatus.count === 0}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
          >
            <ChevronUp className="size-4" />
          </button>
          <button
            type="button"
            aria-label="Next match"
            onClick={() => {
              const h = editorHandles.current.get(activeTabId);
              if (h) setFindStatus(h.findNext());
            }}
            disabled={findStatus.count === 0}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
          >
            <ChevronDown className="size-4" />
          </button>
          <button
            type="button"
            aria-label="Close find"
            onClick={closeFind}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
      )}
      {/* No top padding: the grid starts flush against the tab strip so the panel
          column's border-l runs right up to it (no floating gap). Each column adds
          its own top spacing inside instead. */}
      <div className="flex min-w-0 flex-1 flex-col px-4 pb-3 @container/doc">
        {/* Center + right as a grid: the doc column flexes, the panel is a
            drag-resizable column the grid template adds/removes — cleaner than a
            flex aside for a collapsible sidebar.

            Below 36rem of width (`@container/doc` above) the two cannot share
            the row: the panel is at least 280px, and what was left of a
            phone-width window for the document was a few characters, with the
            view switcher spilling under the panel's heading. There the grid
            is one column and the panel lays over the document instead (the
            aside below goes absolute); the top strip's panel tabs close it. */}
        <div
          ref={gridRef}
          className="relative grid min-h-0 flex-1 grid-cols-[var(--doc-cols)] @max-[36rem]/doc:grid-cols-[minmax(0,1fr)]"
          style={
            {
              // Pin the single row to the track height (minmax(0,1fr), not auto) so a
              // tall doc/panel can't stretch the row and break the columns' internal
              // scroll — each column clamps to the viewport and scrolls its own body.
              gridTemplateRows: "minmax(0, 1fr)",
              // The variable when the workspace hosts us (so a drag can move it
              // without a render); the fallback is the local width the guest page
              // uses, where there is no workspace to set it. A variable rather than
              // the property itself so the container query above can override it.
              "--doc-cols": showAside
                ? `minmax(0,1fr) var(--doc-panel-w, ${panelWidth}px)`
                : "minmax(0,1fr)",
            } as CSSProperties
          }
        >
          <div className="relative flex min-h-0 min-w-0 flex-col @container">
            {/* A shared document edited here without the right to: say so on the
                document, with the ways out. Nothing in a browser. */}
            <LocalForkBanner docId={docId} />
            {/* The doc's header row: the Preview/Markdown switcher centered, the
                actions (Share / Publish / Download) right-aligned. In flow at the
                top of the document column, not floating over the content. Equal
                flex-1 rails on each side keep the switcher centered regardless of
                how wide the actions are.

                The column is a container (@container above) so the action set
                can answer to ITS width, not the viewport's: with the
                comments/history panel open on a small window the column can be
                ~350px, less than the switcher plus three labelled buttons, and
                the buttons used to run out of the column and under the panel's
                heading. Under 32rem the set collapses to one "…" menu. */}
            {chromeInHeader && onOpenShare && (
              <div className="mx-auto flex w-full max-w-3xl shrink-0 items-center px-2 pt-2 pb-1">
                {/* Left rail. Normally empty — it exists to keep the view switcher
                    centred — so the cached-copy badge sits here without moving
                    anything when it appears or goes. */}
                <div className="flex flex-1 items-center">
                  <CachedCopyBadge state={cachedCopy} />
                </div>
                <ViewModeSwitcher
                  mode={viewMode}
                  onPreview={() => setViewMode("preview")}
                  onMarkdown={() => setViewMode("markdown")}
                />
                <div className="flex flex-1 justify-end">
                  <DocActionSet
                    key={docId}
                    isOwner={capability === "owner"}
                    docId={docId}
                    tabDocs={tabDocs}
                    title={tabDocs[0]?.title ?? ""}
                    editable={editable}
                    canComment={canComment}
                    onOpenShare={onOpenShare}
                    isDesktop={isDesktop}
                    publish={publish}
                  />
                </div>
              </div>
            )}
            <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
              <div className="mx-auto max-w-3xl px-2 pt-3 pb-40">
                {viewMode === "markdown" ? (
                  // Editable raw markdown, one textarea per subtab. Each edits its
                  // tab's Y.Doc markdown directly (the source of truth), so the
                  // change reaches the rich editor and the cloud like any edit.
                  tabDocs.map((t, i) => (
                    <section key={i} className="scroll-mt-4">
                      {i > 0 && <hr className="my-8 border-t-2 border-dashed" />}
                      <div className="mb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                        {t.title || "Untitled"}
                      </div>
                      <MarkdownTabEditor
                        docId={t.id}
                        initialMarkdown={t.seedMarkdown}
                        editable={editable}
                      />
                    </section>
                  ))
                ) : previewIndex !== null ? (
                  <CrdtVersionPreview
                    docId={activeTabId}
                    index={previewIndex}
                    canRestore={editable}
                    onBack={() => setPreviewIndex(null)}
                  />
                ) : (
                  tabDocs.map((t, i) => (
                    // Keyed by INDEX, not id: switching docs reuses the section +
                    // editor at each slot and rebinds it to the new subtab's warm
                    // Y.Doc, instead of remounting a fresh editor.
                    <section
                      key={i}
                      ref={(el) => {
                        if (el) sectionRefs.current.set(t.id, el);
                        else sectionRefs.current.delete(t.id);
                      }}
                      className="scroll-mt-4"
                    >
                      {i > 0 && <hr className="my-8 border-t-2 border-dashed" />}
                      <div className="mb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                        {t.title || "Untitled"}
                      </div>
                      <DocEditor
                        stacked
                        ref={(h) => {
                          if (h) editorHandles.current.set(t.id, h);
                          else editorHandles.current.delete(t.id);
                        }}
                        docId={t.id}
                        vaultId={vaultId}
                        initialDoc={t.doc_json}
                        seedMarkdown={t.seedMarkdown}
                        editable={editable}
                        author={userName}
                        onSelectionChange={(sel) => onTabSelection(t.id, sel)}
                        onTitleChange={(title, source) => {
                          setTitles((m) => (m[t.id] === title ? m : { ...m, [t.id]: title }));
                          // A frontmatter title names the doc but must NOT rename
                          // its file — see titleOf in doc-editor.
                          if (source === "heading") scheduleRename(t.id, title);
                        }}
                        onOpenWikiLink={onOpenWikiLink}
                      />
                    </section>
                  ))
                )}
              </div>
            </div>
          </div>

          {showAside && (
            <aside className="relative flex min-h-0 min-w-0 flex-col border-l pl-4 pt-3 @max-[36rem]/doc:absolute @max-[36rem]/doc:inset-0 @max-[36rem]/doc:z-20 @max-[36rem]/doc:border-l-0 @max-[36rem]/doc:bg-background @max-[36rem]/doc:pl-0">
              {/* Drag the left edge to resize the panel. Not when the panel lays
                  over the document: there is no edge to drag. */}
              <div
                onPointerDown={startPanelResize}
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize panel"
                className="absolute inset-y-0 left-0 z-20 w-2 -translate-x-1/2 cursor-col-resize transition-colors hover:bg-foreground/15 @max-[36rem]/doc:hidden"
              />
              {/* In the workspace the panel tabs live in the top strip (split with
                  the doc tabs), so drop the in-aside tab bar there; the guest page
                  keeps it (it has no top strip). */}
              {!chromeInHeader && (
                <div className="mb-2 flex shrink-0 items-center gap-1">
                  {!isGuest && (
                    <TabButton
                      active={panelTab === "analytics"}
                      onClick={() => onPanelTabChange("analytics")}
                      label="Analytics"
                    >
                      <ChartColumn className="size-4" />
                    </TabButton>
                  )}
                  <TabButton
                    active={panelTab === "comments"}
                    onClick={() => onPanelTabChange("comments")}
                    label="Comments"
                  >
                    <MessageSquare className="size-4" />
                  </TabButton>
                  <TabButton
                    active={panelTab === "history"}
                    onClick={() => onPanelTabChange("history")}
                    label="History"
                  >
                    <Clock className="size-4" />
                  </TabButton>
                  {!isGuest && vaultId && (
                    <TabButton
                      active={panelTab === "claude"}
                      onClick={() => void openClaudePanel()}
                      label="Claude Code"
                    >
                      <ClaudeMark className="size-4" />
                    </TabButton>
                  )}
                </div>
              )}
              {panelTab === "claude" && vaultId ? (
                // The chat manages its own scroll/layout, so it sits OUTSIDE the
                // overflow container; `-ml-4` negates the aside's padding so it
                // fills the panel like its own section.
                <div className="-ml-4 min-h-0 flex-1">
                  <AgentChatDock
                    embedded
                    vaultId={vaultId}
                    docId={docId}
                    docPath={docPath ?? undefined}
                    agentId="claude-code"
                    agentName="Claude Code"
                    selection={panelSelection}
                    onOpenFile={onOpenWikiLink ? openAgentFile : undefined}
                  />
                </div>
              ) : (
                <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                  {panelTab === "analytics" ? (
                    // The ACTIVE subtab's document: reads and line credit are per file.
                    <DocAnalytics key={activeTabId} docId={activeTabId} />
                  ) : panelTab === "comments" ? (
                    <CommentsPanel
                      key={activeTabId}
                      docId={activeTabId}
                      canComment={canComment}
                      selection={panelSelection}
                      onQuoteClick={focusComment}
                      user={{ name: userName ?? "", id: userId ?? null }}
                    />
                  ) : (
                    <DocHistory
                      key={activeTabId}
                      docId={activeTabId}
                      selectedVersion={previewIndex}
                      onSelectVersion={setPreviewIndex}
                    />
                  )}
                </div>
              )}
            </aside>
          )}
        </div>
      </div>
    </main>
  );
}

/**
 * A past version in the main area, in place of the editor — the same shape the
 * /steps history had, now fed by the CRDT. Restore writes to this panel's own
 * Y.Doc, which is the SAME document, so it reaches the live editor through the
 * CRDT with no callback and no refetch.
 */
function CrdtVersionPreview({
  docId,
  index,
  canRestore,
  onBack,
}: {
  docId: string;
  index: number;
  canRestore: boolean;
  onBack: () => void;
}) {
  const { diffAt, docJsonAt, restore } = useDocVersions(docId, true);
  return (
    <VersionPreview
      title={"Version " + (index + 1)}
      diff={diffAt(index)}
      docJson={docJsonAt(index)}
      canRestore={canRestore}
      onBack={onBack}
      onRestore={async () => {
        if (restore(index)) onBack(); // back to the editor, now showing it
      }}
    />
  );
}

// One subtab's raw-markdown editor. The Y.Doc's markdown is the document's source
// of truth (the rich editor is a derived view), so this reads/writes it directly
// through the warm CRDT pool — edits reach the rich editor and the cloud like any
// other edit. Acquires the pooled doc while mounted (the pool returns the same
// warm entry the rich editor uses, so switching modes is instant, not a reload).
function MarkdownTabEditor({
  docId,
  initialMarkdown,
  editable,
}: {
  docId: string;
  initialMarkdown: string;
  editable: boolean;
}) {
  const [value, setValue] = useState(initialMarkdown);
  const entryRef = useRef<CrdtEntry | null>(null);
  const focused = useRef(false);

  const ports = useDocsPorts();
  useEffect(() => {
    let disposed = false;
    let unobserve = () => {};
    const pool = docCrdtPool(ports);
    void pool.acquire(docId, initialMarkdown).then((entry) => {
      if (disposed) {
        pool.release(docId);
        return;
      }
      entryRef.current = entry;
      setValue(getMarkdown(entry.doc));
      // Reflect edits from elsewhere (the rich editor, other clients, the vault
      // file) — but not our own writes, and not while the user is typing here.
      unobserve = observeMarkdown(entry.doc, (origin) => {
        if (origin === "editor" || focused.current) return;
        setValue(getMarkdown(entry.doc));
      });
    });
    return () => {
      disposed = true;
      unobserve();
      if (entryRef.current) {
        pool.release(docId);
        entryRef.current = null;
      }
    };
    // Seeded once per doc; initialMarkdown is only a first-open fallback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, ports]);

  // Write straight through on every change (a minimal Y.Text diff, like the rich
  // editor does) — no debounce, so flipping back to Preview right after a keystroke
  // can't drop the last edit. Our "editor"-origin writes are ignored by the observer.
  const onChange = (next: string) => {
    setValue(next);
    const entry = entryRef.current;
    if (entry && editable) setMarkdown(entry.doc, next, "editor");
  };

  return (
    <div
      onFocusCapture={() => (focused.current = true)}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) focused.current = false;
      }}
    >
      <DocMarkdownEditor value={value} editable={editable} onChange={onChange} />
    </div>
  );
}

// The centered Preview / Markdown segmented control in the doc header row.
// Exported for a shell that draws the header itself (the desktop's file window).
export function ViewModeSwitcher({
  mode,
  onPreview,
  onMarkdown,
}: {
  mode: DocViewMode;
  onPreview: () => void;
  onMarkdown: () => void;
}) {
  const seg = (active: boolean) =>
    cn(
      "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
      active
        ? "bg-background text-foreground shadow-sm"
        : "text-muted-foreground hover:text-foreground"
    );
  return (
    <div className="inline-flex items-center rounded-lg border bg-muted/50 p-0.5">
      <button type="button" onClick={onPreview} className={seg(mode === "preview")}>
        <Eye className="size-3.5" />
        Preview
      </button>
      <button type="button" onClick={onMarkdown} className={seg(mode === "markdown")}>
        <Code2 className="size-3.5" />
        Markdown
      </button>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
  children,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        "rounded-md p-1.5",
        active ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}
