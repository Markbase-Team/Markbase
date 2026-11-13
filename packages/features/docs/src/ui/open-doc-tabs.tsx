"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  PanelLeftOpen,
  Pin,
  PinOff,
  Plus,
  X,
} from "lucide-react";
import { layoutTabs, tabCapacity } from "@markbase/docs/workspace-tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@markbase/ui/dropdown-menu";
import { cn } from "@markbase/ui/utils";

/** One tab as the strip draws it. */
export type StripTab = { tabId: string; title: string; pinned: boolean };

/** A tab at its narrowest (`min-w-[7.5rem]`) and the gap between tabs (`gap-1`),
 *  in px. Keep in step with those classes: the overflow maths runs on these. */
const MIN_TAB_PX = 120;
const TAB_GAP_PX = 4;

/**
 * The tab strip across the top of the workspace, styled like a browser: the
 * active tab lifts to the content colour with rounded top corners and no bottom
 * seam, so it visually MERGES into the document below; inactive tabs stay
 * recessed in the strip.
 *
 * Tabs are workspaces (see @markbase/docs/workspace-tabs): each shows the
 * document it's currently on, and Back/Forward step through its history. `+`
 * opens a blank tab; right-click a tab to pin it or close others. Per-device
 * only — the tabs are persisted to localStorage (see DocsShell).
 */
export function OpenDocTabs({
  tabs,
  activeTabId,
  onSelect,
  onClose,
  onCloseOthers,
  onCloseAll,
  onPin,
  onNewTab,
  canBack,
  canForward,
  onBack,
  onForward,
  sidebarCollapsed = false,
  onExpandSidebar,
  isDesktop = false,
  rightSlot,
}: {
  tabs: StripTab[];
  activeTabId: string | null;
  onSelect: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onCloseOthers: (tabId: string) => void;
  onCloseAll: () => void;
  onPin: (tabId: string, pinned: boolean) => void;
  onNewTab: () => void;
  /** Whether the active tab has somewhere to go Back / Forward to. */
  canBack: boolean;
  canForward: boolean;
  onBack: () => void;
  onForward: () => void;
  /** When the sidebar is collapsed on desktop, the (wider) header overhangs into
   *  the workspace to clear the traffic lights; reserve that width so the first
   *  tab starts after it. On web the collapsed header fits within the rail. */
  sidebarCollapsed?: boolean;
  /** Reopen the file sidebar. Absent where there is no sidebar to reopen. */
  onExpandSidebar?: () => void;
  isDesktop?: boolean;
  /** The active doc's chrome (Share / Publish / Download / panel toggle), pinned
   *  to the right of this strip so the whole top row is one "right header". The
   *  workspace portals its buttons in here — this is just the mount point. */
  rightSlot?: React.ReactNode;
}) {
  // Which tab's right-click menu is open.
  const [menuFor, setMenuFor] = useState<string | null>(null);
  // The strip doesn't scroll. Tabs shrink to a readable minimum, and the ones
  // that still don't fit go in the overflow menu — so it has to know how wide
  // the tabs area is. Null until measured (the server can't), which shows all.
  const areaRef = useRef<HTMLDivElement>(null);
  const [areaWidth, setAreaWidth] = useState<number | null>(null);
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width !== undefined) setAreaWidth(width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const capacity =
    areaWidth === null ? Number.POSITIVE_INFINITY : tabCapacity(areaWidth, MIN_TAB_PX, TAB_GAP_PX);
  const { visible, overflow } = layoutTabs(tabs, activeTabId, capacity);
  // On desktop the strip doubles as the frameless window's title bar: the empty
  // areas are a drag region (so the window moves, and macOS double-click-to-zoom
  // works), while the interactive bits below opt out with `no-drag`.
  const drag = isDesktop ? "[-webkit-app-region:drag]" : "";
  // Also force descendant SVGs to no-drag: an icon (close X, +) doesn't inherit the
  // button's no-drag, so a real click would land on the SVG and drag the window.
  const noDrag = isDesktop
    ? "[-webkit-app-region:no-drag] [&_svg]:[-webkit-app-region:no-drag]"
    : "";
  const navButton =
    "rounded-md p-1.5 text-muted-foreground/80 transition hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-30";
  // h-11 matches the DocsHeader height so both bottom lines align horizontally.
  return (
    <div className={cn("relative flex h-11 shrink-0 items-stretch bg-muted/40", drag)}>
      {/* The bottom line runs under the WHOLE strip (tabs + right chrome); the
          active tab (opaque, z-10) paints over it, so the line is "notched" out
          under the selected tab and it merges into the document. Drawn as an
          element rather than a border so overflow-x-auto's vertical clip can't
          hide the notch, and on the outer row so it spans the right chrome too. */}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 z-0 h-px bg-border"
        aria-hidden
      />
      {/* No sideways scrolling. It used to scroll with its scrollbar "hidden" by
          ::-webkit-scrollbar — which Chromium ignores once scrollbar-width is set,
          so a thin bar showed anyway. Overflow is a menu now (below). */}
      <div className="flex min-w-0 flex-1 items-end gap-1 overflow-hidden px-2 pt-1.5">
        {/* With the sidebar collapsed this strip is the leftmost thing in the
            window, so on desktop it is what has to leave room for the macOS
            traffic lights — the sidebar's header, which reserves it otherwise,
            is not rendered then. Same width DocsHeader reserves, from the same
            variable the shell sets. */}
        {isDesktop && sidebarCollapsed && (
          <div className="w-[var(--traffic-light-inset,76px)] shrink-0" aria-hidden />
        )}
        {/* The way back to the file tree once the sidebar is collapsed — the
            sidebar's own header, and its collapse toggle, go with the column. */}
        {sidebarCollapsed && onExpandSidebar && (
          <button
            type="button"
            onClick={onExpandSidebar}
            aria-label="Show documents"
            title="Show documents (⌘\)"
            className={cn("mb-1.5 shrink-0 self-center", navButton, noDrag)}
          >
            <PanelLeftOpen className="size-4" strokeWidth={1.5} />
          </button>
        )}
        {/* Back / Forward through the active tab's history. */}
        <div className={cn("mb-1.5 flex shrink-0 items-center self-center", noDrag)}>
          <button
            type="button"
            onClick={onBack}
            disabled={!canBack}
            aria-label="Back"
            title="Back"
            className={navButton}
          >
            <ArrowLeft className="size-4" strokeWidth={1.5} />
          </button>
          <button
            type="button"
            onClick={onForward}
            disabled={!canForward}
            aria-label="Forward"
            title="Forward"
            className={navButton}
          >
            <ArrowRight className="size-4" strokeWidth={1.5} />
          </button>
        </div>
        <div ref={areaRef} className="flex min-w-0 flex-1 items-end gap-1 overflow-hidden">
        {visible.map((t) => {
          const active = t.tabId === activeTabId;
          return (
            <DropdownMenu
              key={t.tabId}
              open={menuFor === t.tabId}
              onOpenChange={(open) => setMenuFor(open ? t.tabId : null)}
            >
              <div
                onMouseDown={(e) => {
                  // Middle-click closes, like a browser.
                  if (e.button === 1) {
                    e.preventDefault();
                    onClose(t.tabId);
                  }
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenuFor(t.tabId);
                }}
                className={cn(
                  // Shrink to fit, floored at 7.5rem so a title stays readable
                  // (about ten characters); past that, tabs go in the overflow menu.
                  "group relative flex min-w-[7.5rem] max-w-60 shrink items-center gap-2 rounded-t-lg px-3 py-2 text-sm transition-colors",
                  noDrag,
                  active
                    ? "z-10 border border-b-0 border-border bg-background font-medium text-foreground shadow-[0_-2px_6px_-3px_rgba(0,0,0,0.18)]"
                    : "text-muted-foreground hover:bg-background/60"
                )}
              >
                <button
                  type="button"
                  onClick={() => onSelect(t.tabId)}
                  className="min-w-0 flex-1 truncate text-left"
                  title={t.title}
                >
                  {t.title}
                </button>
                {t.pinned ? (
                  // A pinned tab keeps what it shows: opening a document from it
                  // opens a new tab. Its pin stands where the close button was.
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onPin(t.tabId, false);
                    }}
                    aria-label={`Unpin ${t.title}`}
                    title="Pinned — click to unpin"
                    className="-mr-1 shrink-0 rounded-md p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
                  >
                    <Pin className="size-3.5" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onClose(t.tabId);
                    }}
                    aria-label={`Close ${t.title}`}
                    className={cn(
                      "-mr-1 shrink-0 rounded-md p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground",
                      active ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                    )}
                  >
                    <X className="size-3.5" />
                  </button>
                )}
                {/* Where the right-click menu hangs from. Never under the pointer,
                    so a plain click on the tab still just selects it. */}
                <DropdownMenuTrigger asChild>
                  <span aria-hidden className="pointer-events-none absolute bottom-0 left-2 size-0" />
                </DropdownMenuTrigger>
              </div>
              <DropdownMenuContent align="start" className="min-w-44">
                <DropdownMenuItem onSelect={() => onPin(t.tabId, !t.pinned)}>
                  {t.pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
                  {t.pinned ? "Unpin" : "Pin"}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => onClose(t.tabId)}>Close</DropdownMenuItem>
                <DropdownMenuItem
                  disabled={tabs.length < 2}
                  onSelect={() => onCloseOthers(t.tabId)}
                >
                  Close others
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={onCloseAll}>Close all</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          );
        })}
        </div>
        {overflow.length > 0 && (
          // The tabs that don't fit. The menu lists EVERY tab, so it's also the
          // quickest way to any of them; picking a hidden one brings it onto the
          // strip, because the active tab always shows.
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={`${overflow.length} more ${overflow.length === 1 ? "tab" : "tabs"}`}
                title="All tabs"
                className={cn(
                  "mb-1 flex h-7 shrink-0 items-center gap-0.5 rounded-md px-1.5 text-xs font-medium text-muted-foreground transition hover:bg-background hover:text-foreground",
                  noDrag
                )}
              >
                <ChevronDown className="size-3.5" />
                {overflow.length}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-80 w-64 overflow-y-auto">
              {tabs.map((t) => (
                <DropdownMenuItem key={t.tabId} onSelect={() => onSelect(t.tabId)}>
                  {t.tabId === activeTabId ? (
                    <Check className="size-4" />
                  ) : t.pinned ? (
                    <Pin className="size-4" />
                  ) : (
                    <span className="size-4 shrink-0" aria-hidden />
                  )}
                  <span className="min-w-0 flex-1 truncate">{t.title}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <button
          type="button"
          onClick={onNewTab}
          aria-label="New tab"
          title="New tab"
          className={cn(
            "mb-1 ml-0.5 flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-background hover:text-foreground",
            noDrag
          )}
        >
          <Plus className="size-4" />
        </button>
      </div>
      {/* Right header: the panel's tab bar, pinned outside the scroll area so it
          never scrolls away with the tabs. pr-4 matches the doc grid's px-4 so an
          open panel-width tab region lines its split up with the panel column. */}
      <div className={cn("relative z-10 flex shrink-0 items-stretch pr-4", noDrag)}>
        {rightSlot}
      </div>
    </div>
  );
}
