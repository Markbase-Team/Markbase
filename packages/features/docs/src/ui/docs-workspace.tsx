"use client";

import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type CSSProperties,
} from "react";
import { Clock, FileText, Files, MessageSquare, PanelRightClose, X } from "lucide-react";
import type { Capability } from "@markbase/docs/server";
import { cn } from "@markbase/ui/utils";
import { AgentMenu } from "./doc-action-set";
import { OpenDocTabs } from "./open-doc-tabs";
import {
  currentEntry,
  reachableDocIds,
  type DocTab,
  type OpenIntent,
} from "@markbase/docs/workspace-tabs";
import { DocView } from "./doc-view";
import { ShareDialog } from "./share-dialog";
import { DocClientProvider } from "./doc-client";
import { DocNoAccess } from "./[id]/no-access";
import { useDocsStore, seedLocalWorkspace, type WorkspaceEntry } from "./docs-store";
import { readLocalDoc } from "./vault-index-client";
import { docCrdtPool } from "./doc-crdt-pool";
import { useDocsPorts } from "./ports";
import { DEFAULT_PANEL_WIDTH, savedPanelWidth, startPanelDrag } from "./panel-width";
import { useClientValue } from "./client-value";
import { AgentChatDock } from "./agent-chat-dock";
import type { EditorSelection } from "./doc-editor";

type PanelTab = "tabs" | "comments" | "history" | "claude";

// How many recently-viewed docs keep their editors mounted. Flipping among these
// is an instant visibility toggle (no content rebuild, no refetch); older docs
// unmount, and their Y.Docs stay warm in the pool for a fast remount.
const MAX_ALIVE = 4;

/**
 * The working surface for the whole open-tab set: the tab strip, the active
 * document's actions in the same top row (the "right header"), and the active
 * document itself (center) with its comments/history panel (right column).
 *
 * It's mounted ONCE by DocsShell (fed the active id). It keeps the last few
 * viewed docs' editors mounted (see MAX_ALIVE) and toggles visibility, so
 * flipping between recent tabs is instant — no editor rebuild, no CRDT reconnect.
 * It reads each doc's data from the client store, so the tabs stay put while a
 * first-time doc's center shows a skeleton.
 */
export function DocsWorkspace({
  tabs,
  activeTabId,
  activeId,
  canBack,
  canForward,
  onBack,
  onForward,
  onSelectTab,
  onCloseTab,
  onCloseOtherTabs,
  onCloseAllTabs,
  onPinTab,
  onNewTab,
  onCloseActiveTab,
  pinnedActive,
  sidebarCollapsed,
  onExpandSidebar,
  isDesktop,
  userId,
  userName,
  vaultId,
  onOpenWikiLink,
}: {
  tabs: DocTab[];
  activeTabId: string | null;
  /** The document the active tab is showing — null for a blank tab or none. */
  activeId: string | null;
  canBack: boolean;
  canForward: boolean;
  onBack: () => void;
  onForward: () => void;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onCloseOtherTabs: (tabId: string) => void;
  onCloseAllTabs: () => void;
  onPinTab: (tabId: string, pinned: boolean) => void;
  onNewTab: () => void;
  onCloseActiveTab: () => void;
  /** The active tab is pinned — the blank canvas says where things will open. */
  pinnedActive: boolean;
  sidebarCollapsed: boolean;
  onExpandSidebar?: () => void;
  isDesktop: boolean;
  userId: string | null;
  userName: string;
  /** The focused vault — lets a document be shown from local data alone. */
  vaultId?: string | null;
  /** Follow a `[[wiki-link]]`: resolve to a vault doc and open it — here, or in a new tab. */
  onOpenWikiLink?: (target: string, intent: OpenIntent) => void;
}) {
  const store = useDocsStore();
  const ports = useDocsPorts();
  const entry = activeId ? store.get(activeId) : undefined;

  // The right column (comments/history/subtabs) and its active tab persist across
  // doc switches as a workspace-level preference — the shared top-row actions and
  // the surface both read them, so they live here.
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelTab, setPanelTab] = useState<PanelTab>("tabs");
  const [shareOpen, setShareOpen] = useState(false);
  // The panel column width lives here too (not just in DocView) so the top strip's
  // panel-tab bar can be exactly this wide — the split lines up with the panel
  // column below. DocView drives it as the user drags; we seed it from the saved
  // value and mirror it to the tab bar.
  // The stored width is a browser fact, so it arrives through useClientValue —
  // the server renders the default and the browser replaces it. `dragged` is the
  // width this session has set since, which simply wins when there is one.
  const stored = useClientValue(savedPanelWidth, DEFAULT_PANEL_WIDTH);
  const [dragged, setDragged] = useState<number | null>(null);
  const panelWidth = dragged ?? stored;
  const setPanelWidth = setDragged;

  // Most-recently-viewed doc ids, newest first — the basis for which editors stay
  // mounted. Every doc here was active at some point, so it's already loaded.
  const [mru, setMru] = useState<string[]>([]);
  useEffect(() => {
    if (activeId) {
      store.load(activeId);
      // Side by side with the load above, not behind it: the editor mounts only
      // once that resolves, and the snapshot is what actually carries the
      // document's content. Warming it here means it's already in hand by the
      // time the editor asks.
      docCrdtPool(ports).prefetch(activeId);
      // And if this machine already holds the document, show it NOW rather than
      // waiting on a call that carries no content — see seedLocalWorkspace.
      if (vaultId) {
        void readLocalDoc(ports, vaultId, activeId).then((local) => {
          if (local) seedLocalWorkspace(activeId, { vaultId, title: local.title, path: local.path });
        });
      }
    }
  }, [activeId, store, vaultId, ports]);

  // The MRU is adjusted during render rather than from an effect: it is derived
  // from activeId, and an effect would order it one commit behind the switch it
  // is describing.
  const [mruFor, setMruFor] = useState<string | null>(null);
  if (activeId && mruFor !== activeId) {
    setMruFor(activeId);
    setMru((prev) => [activeId, ...prev.filter((x) => x !== activeId)].slice(0, 12));
  }

  // Stable, because it is a prop of the memoised slots below: an inline arrow
  // would be a new function on every render and defeat the memo on its own.
  const openShare = useCallback(() => setShareOpen(true), []);

  // The kept-alive set: the active doc plus the most recent ones any tab can still
  // reach — on screen, or a Back/Forward away — capped. So stepping Back is often
  // an instant visibility toggle, scroll position and all. Active is always first
  // so the very first render (before the effect updates mru) still mounts it.
  const reachable = reachableDocIds(tabs);
  const aliveIds = activeId
    ? [activeId, ...mru.filter((id) => id !== activeId && reachable.has(id))].slice(0, MAX_ALIVE)
    : [];

  const data = entry?.status === "ready" ? entry.data : null;
  // Retain the last-loaded capability so the actions don't flicker (Share/Publish
  // appearing then disappearing) during the brief moment a not-yet-cached doc's
  // data is loading — most consecutive docs share the same capability anyway.
  const [lastCap, setLastCap] = useState<Capability | null>(null);
  if (data && data.capability !== lastCap) setLastCap(data.capability);
  const cap = data?.capability ?? lastCap;
  const isOwner = cap === "owner";

  // ONE agent panel for the whole workspace, not one per document.
  //
  // It used to live inside each document's view, so it belonged to that
  // document: moving to another one showed a different panel, and once the old
  // document dropped out of the kept-alive set its panel unmounted — which closes
  // the Claude process, killing whatever the agent was in the middle of. Tabs are
  // workspaces now and you move between documents inside one all the time, so
  // the conversation has to outlive that.
  //
  // So the workspace draws it: a column beside the documents, in the same place
  // in the tree whatever is on screen — a document, one still loading, a blank
  // tab — so it never vanishes, jumps or remounts. With the Claude tab showing,
  // each document gives up its own right-hand column (DocView's agentHosted).
  const rootRef = useRef<HTMLDivElement>(null);
  const agentColRef = useRef<HTMLDivElement>(null);
  // The vault the conversation runs in: the document's own (Shared-with-me mixes
  // vaults), kept through a document that's still loading so the panel doesn't
  // close mid-switch; before any document, the focused vault. A different vault
  // is a different folder, so a fresh panel (the dock is keyed by it).
  const [docVault, setDocVault] = useState<string | null>(null);
  if (data?.vaultId && data.vaultId !== docVault) setDocVault(data.vaultId);
  const agentVault = docVault ?? vaultId ?? null;
  const agentOpen = panelOpen && panelTab === "claude" && agentVault !== null;
  // The column's left edge is a resize handle, like the document panel's.
  const startAgentResize = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      const col = agentColRef.current;
      if (!col) return;
      startPanelDrag({
        rightEdge: col.getBoundingClientRect().right,
        host: rootRef.current,
        start: panelWidth,
        apply: setPanelWidth,
      });
    },
    [panelWidth, setPanelWidth]
  );
  // The active document's selection, offered to the agent as context.
  const [agentSel, setAgentSel] = useState<{ docId: string; sel: EditorSelection } | null>(null);
  const reportAgentSelection = useCallback((docId: string, sel: EditorSelection | null) => {
    setAgentSel((prev) => (sel ? { docId, sel } : prev?.docId === docId ? null : prev));
  }, []);
  // The agent's file links: ⌘/Ctrl-click opens them in a new tab.
  const openAgentFile = useCallback(
    (path: string, opts?: { newTab: boolean }) =>
      onOpenWikiLink?.(path, opts?.newTab ? "new" : "current"),
    [onOpenWikiLink]
  );
  // Same geometry as the document panel it replaces: panel-width wide, a left
  // border, the documents' 16px right inset (so it lines up with the panel tabs
  // in the strip above), 12px top and bottom.
  const agentColumn = agentOpen && agentVault ? (
    <div
      ref={agentColRef}
      className="relative mr-4 flex min-h-0 shrink-0 flex-col border-l pt-3 pb-3"
      style={{ width: `var(--doc-panel-w, ${panelWidth}px)` }}
    >
      <div
        onPointerDown={startAgentResize}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize panel"
        className="absolute inset-y-0 left-0 z-20 w-2 -translate-x-1/2 cursor-col-resize transition-colors hover:bg-foreground/15"
      />
      <AgentChatDock
        key={agentVault}
        embedded
        vaultId={agentVault}
        docId={activeId ?? undefined}
        docPath={data?.path ?? undefined}
        agentId="claude-code"
        agentName="Claude Code"
        selection={agentSel && agentSel.docId === activeId ? agentSel.sel : null}
        onOpenFile={onOpenWikiLink ? openAgentFile : undefined}
      />
    </div>
  ) : null;

  const tabStrip = (
    <OpenDocTabs
      tabs={tabs.map((t) => ({
        tabId: t.tabId,
        title: currentEntry(t)?.title || "New tab",
        pinned: t.pinned,
      }))}
      activeTabId={activeTabId}
      onSelect={onSelectTab}
      onClose={onCloseTab}
      onCloseOthers={onCloseOtherTabs}
      onCloseAll={onCloseAllTabs}
      onPin={onPinTab}
      onNewTab={onNewTab}
      canBack={canBack}
      canForward={canForward}
      onBack={onBack}
      onForward={onForward}
      sidebarCollapsed={sidebarCollapsed}
      onExpandSidebar={onExpandSidebar}
      isDesktop={isDesktop}
      rightSlot={
        // The right side of the top strip is the panel's tab bar (split from the
        // doc tabs). Always mounted when a doc is active so it never remounts on a
        // switch. The doc's own actions (Share/Publish/…) moved into the content.
        activeId ? (
          <PanelTabBar
            panelTab={panelTab}
            panelOpen={panelOpen}
            onPanelTabChange={setPanelTab}
            onPanelOpenChange={setPanelOpen}
            // The agent column's vault, not the loading document's: AgentMenu hides
            // itself without one, so `data?.vaultId` made the icon vanish and come
            // back on every switch to a document that wasn't cached yet.
            vaultId={agentVault}
            docId={activeId}
            docPath={data?.path ?? null}
            onOpenAgentPanel={() => {
              setPanelTab("claude");
              setPanelOpen(true);
            }}
          />
        ) : null
      }
    />
  );

  // One tree whatever is on screen — a document, or a blank tab — so the agent
  // column beside it keeps its place and never remounts (which would close its
  // conversation).
  return (
    <DocClientProvider docId={activeId ?? ""}>
      {/* The panel's width lives here as a CSS variable rather than only as a
          prop, because dragging it used to be a state change per pointermove —
          which re-rendered every mounted document, sixty times a second. Everything
          that needs the width (this strip's tab bar, each doc's grid column, the
          agent column) reads the variable, so the drag can write it straight to
          this node and React need not hear about it until the pointer comes up. */}
      <div
        ref={rootRef}
        data-doc-workspace
        className="flex min-w-0 flex-1 flex-col"
        style={{ "--doc-panel-w": `${panelWidth}px` } as CSSProperties}
      >
        {tabStrip}
        {activeId && isOwner && (
          <ShareDialog docId={activeId} open={shareOpen} onOpenChange={setShareOpen} />
        )}
        <div className="flex min-h-0 flex-1">
          {activeId ? (
            // Keep-alive stack: one mounted slot per recently-viewed doc, the
            // active one shown, the rest display:none. Switching between them is a
            // visibility toggle — no editor rebuild, no CRDT reconnect.
            <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
              {aliveIds.map((id) => (
            <div key={id} className={cn("h-full", id === activeId ? "block" : "hidden")}>
              <DocViewSlot
                entry={store.get(id)}
                userId={userId}
                userName={userName}
                panelOpen={panelOpen}
                panelTab={panelTab}
                onPanelTabChange={setPanelTab}
                panelWidth={panelWidth}
                onPanelWidthChange={setPanelWidth}
                onOpenShare={openShare}
                isDesktop={isDesktop}
                onOpenWikiLink={onOpenWikiLink}
                onCloseTab={onCloseActiveTab}
                onAgentSelection={reportAgentSelection}
              />
            </div>
              ))}
            </div>
          ) : (
            // No document in this tab (a blank tab, or no tabs): an empty canvas.
            <div className="grid min-h-0 min-w-0 flex-1 place-items-center text-sm text-muted-foreground">
              {pinnedActive
                ? "This tab is pinned — documents you open will open in a new tab."
                : "Select a document, or create one."}
            </div>
          )}
          {agentColumn}
        </div>
      </div>
    </DocClientProvider>
  );
}

/**
 * One kept-alive slot: the doc's editor (or its load/error state) for a single
 * id. Its DocView stays mounted while the id is in the alive set, so switching
 * to it is instant. panelOpen/panelTab are shared (workspace-level).
 *
 * Memoised, because "instant" was only true of the DOM. Up to MAX_ALIVE slots
 * are mounted at once, each a whole document — editors, panel, and, when the
 * Claude tab is the open one, a chat dock with its transcript. Switching tabs
 * changed nothing about any of them except which wrapper carries `hidden`, and
 * still re-rendered all four. None of these props change on a switch (the store
 * hands back the same entry object for an unchanged doc, and the callbacks are
 * stable), so now none of the slots re-render either.
 */
const DocViewSlot = memo(function DocViewSlot({
  entry,
  userId,
  userName,
  panelOpen,
  panelTab,
  onPanelTabChange,
  panelWidth,
  onPanelWidthChange,
  onOpenShare,
  isDesktop,
  onOpenWikiLink,
  onCloseTab,
  onAgentSelection,
}: {
  entry: WorkspaceEntry | undefined;
  userId: string | null;
  userName: string;
  panelOpen: boolean;
  panelTab: PanelTab;
  onPanelTabChange: (tab: PanelTab) => void;
  panelWidth: number;
  onPanelWidthChange: (width: number) => void;
  onOpenShare: () => void;
  isDesktop: boolean;
  onOpenWikiLink?: (target: string, intent: OpenIntent) => void;
  /** Close the tab this document is in — the way out of a notice. */
  onCloseTab: () => void;
  /** Report this document's selection to the workspace's agent panel. */
  onAgentSelection: (docId: string, sel: EditorSelection | null) => void;
}) {
  if (!entry || entry.status === "loading") return <WorkspaceSkeleton />;
  if (entry.status === "no-access") return <DocNoAccess ownerName={null} />;
  if (entry.status === "not-found")
    return <WorkspaceNotice title="This document doesn't exist" onClose={onCloseTab} />;
  if (entry.status === "invalid")
    return (
      <WorkspaceNotice
        title="This document predates the editor upgrade"
        body="Its saved format isn't compatible with the new editor. Create a new document to continue."
        onClose={onCloseTab}
      />
    );
  if (entry.status === "error")
    return (
      <WorkspaceNotice
        title="Couldn't load this document"
        body={entry.message}
        onClose={onCloseTab}
      />
    );
  return (
    <DocView
      docId={entry.data.docId}
      vaultId={entry.data.vaultId}
      docPath={entry.data.path}
      publish={entry.data.publish}
      capability={entry.data.capability}
      tabDocs={entry.data.tabDocs}
      userName={userName}
      userId={userId}
      panelOpen={panelOpen}
      panelTab={panelTab}
      onPanelTabChange={onPanelTabChange}
      panelWidth={panelWidth}
      onPanelWidthChange={onPanelWidthChange}
      onOpenShare={onOpenShare}
      isDesktop={isDesktop}
      chromeInHeader
      onOpenWikiLink={onOpenWikiLink}
      agentHosted
      onAgentSelection={onAgentSelection}
    />
  );
});

// The panel's tab bar, living in the top strip's right side (split from the doc
// tabs). Clicking a tab opens the right panel to it; clicking the active one again
// closes the panel. Subtab / Comments / History always show; Claude Code needs a
// vault.
function PanelTabBar({
  panelTab,
  panelOpen,
  onPanelTabChange,
  onPanelOpenChange,
  vaultId,
  docId,
  docPath,
  onOpenAgentPanel,
}: {
  panelTab: PanelTab;
  panelOpen: boolean;
  onPanelTabChange: (tab: PanelTab) => void;
  onPanelOpenChange: (open: boolean) => void;
  vaultId: string | null;
  docId: string;
  docPath: string | null;
  onOpenAgentPanel: () => void;
}) {
  const tab = (id: PanelTab, label: string, Icon: ComponentType<{ className?: string }>) => (
    <button
      key={id}
      type="button"
      onClick={() => {
        if (panelOpen && panelTab === id) onPanelOpenChange(false);
        else {
          onPanelTabChange(id);
          onPanelOpenChange(true);
        }
      }}
      aria-label={label}
      title={label}
      className={cn(
        "rounded-md p-1.5 transition-colors",
        panelOpen && panelTab === id
          ? "bg-muted text-foreground"
          : "text-muted-foreground hover:bg-muted hover:text-foreground"
      )}
    >
      <Icon className="size-4" />
    </button>
  );
  // When the panel is open the bar becomes the panel column's header: exactly
  // panelWidth wide with a left border, so the split lines up with the panel's
  // border below and the tabs sit at its left (aligned with the panel content).
  // Closed, it's just the compact icon row pinned to the strip's right edge.
  return (
    <div
      className={cn(
        "flex h-full items-center",
        panelOpen ? "border-l border-border pl-4" : "justify-end"
      )}
      style={panelOpen ? { width: "var(--doc-panel-w, 320px)" } : undefined}
    >
      <div className="flex items-center gap-0.5">
        {tab("tabs", "Subtab", Files)}
        {tab("comments", "Comments", MessageSquare)}
        {tab("history", "History", Clock)}
        {/* The Claude Code icon is replaced by the agent menu ("Open in this
            vault's folder"): its Claude Code item opens the same right panel. */}
        <AgentMenu
          vaultId={vaultId}
          docId={docId}
          docPath={docPath}
          active={panelOpen && panelTab === "claude"}
          onOpenAgentPanel={onOpenAgentPanel}
        />
      </div>
      {/* When the panel is expanded, a right-aligned shrink button collapses it
          (replacing the old in-panel close button). */}
      {panelOpen && (
        <>
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => onPanelOpenChange(false)}
            aria-label="Collapse panel"
            title="Collapse panel"
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <PanelRightClose className="size-4" />
          </button>
        </>
      )}
    </div>
  );
}

/**
 * The shape of a document, while the document loads.
 *
 * This was a spinner centred in an empty pane, which on a full-height surface
 * reads as a blank white screen with a speck in the middle — indistinguishable
 * from a page that failed. A skeleton in the SAME geometry as the real thing
 * (mx-auto, max-w-3xl, px-2 — see doc-view) says "text is coming, here" instead,
 * and the swap is a fill rather than a jump, because nothing moves.
 *
 * Deliberately not a spinner AND a skeleton: two loading signals for one wait is
 * noise. The pulse is the signal.
 */
function WorkspaceSkeleton() {
  // Uneven, because prose is. Equal bars read as a table, not a paragraph.
  const lines = ["w-11/12", "w-full", "w-4/5", "w-full", "w-2/3"];
  return (
    <div className="h-full w-full overflow-hidden" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading document…</span>
      <div className="mx-auto max-w-3xl px-2 pt-3" aria-hidden>
        {/* Title */}
        <div className="h-8 w-1/2 animate-pulse rounded-md bg-muted" />
        <div className="mt-8 space-y-3">
          {lines.map((w, i) => (
            <div key={i} className={cn("h-4 animate-pulse rounded bg-muted/70", w)} />
          ))}
        </div>
        {/* A second block, so the page doesn't look like it ends after one paragraph. */}
        <div className="mt-9 h-5 w-1/3 animate-pulse rounded-md bg-muted" />
        <div className="mt-4 space-y-3">
          {lines.slice(0, 3).map((w, i) => (
            <div key={i} className={cn("h-4 animate-pulse rounded bg-muted/70", w)} />
          ))}
        </div>
      </div>
    </div>
  );
}

function WorkspaceNotice({
  title,
  body,
  onClose,
}: {
  title: string;
  body?: string;
  onClose: () => void;
}) {
  // "Back to documents" linked to the index, which in a tab-as-workspace surface
  // just shows the same tab again. Closing the tab is the way out.
  return (
    <div className="mx-auto flex h-full w-full max-w-md flex-col items-center justify-center px-6 text-center">
      <div className="grid size-12 place-items-center rounded-full bg-muted">
        <FileText className="size-6 text-muted-foreground" />
      </div>
      <h1 className="mt-5 text-lg font-semibold tracking-tight">{title}</h1>
      {body && <p className="mt-2 text-sm text-muted-foreground">{body}</p>}
      <button
        type="button"
        onClick={onClose}
        className="mt-6 inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition hover:bg-muted"
      >
        <X className="size-4" />
        Close tab
      </button>
    </div>
  );
}
