"use client";

import { FilePlus, FolderPlus, PanelLeftClose, Search } from "lucide-react";
import { cn } from "@markbase/ui/utils";

// The header row of the documentation sidebar: the icon-only create actions,
// the search toggle and the collapse toggle. On desktop it also reserves room
// at its left for the macOS traffic lights and is a drag region, so it doubles
// as that side of the frameless window's title bar.
//
// It is an ordinary in-flow row, rendered INSIDE the sidebar column by
// DocsShell — not a fixed element sized by a formula. It used to be
// `fixed top-0 left-0` with a width of `var(--sidebar-width-icon) + 16rem`,
// spanning the web shell's icon rail as well as this sidebar. That lines up
// only when a 3rem rail is actually to its left; the desktop app mounts this
// surface with no rail at all, and there the header overshot the sidebar by
// 3rem and its right edge sat visibly past the sidebar's. In the column, it is
// the column's width wherever the surface is mounted, and the row to its right
// (the tab strip, also h-11) lines up by construction. The rail's own top cap
// is the web shell's to paint — see AppSidebar in apps/web.
//
// When the sidebar is collapsed there is no column to sit in and this is not
// rendered. The tab strip hosts the expand affordance then, and on desktop
// the traffic-light room too.

export function DocsHeader({
  isDesktop,
  canCreate,
  creating,
  bare,
  searching,
  onToggleSearch,
  onNewFolder,
  onNewDoc,
  onCollapse,
}: {
  isDesktop: boolean;
  canCreate: boolean;
  creating?: boolean;
  /**
   * There is no sidebar at all (no vault yet, or the vault list couldn't load),
   * so this is one full-width title-bar row: traffic-light room and the window
   * drag region, nothing to act on.
   */
  bare?: boolean;
  /** The sidebar is showing search rather than the file tree. */
  searching?: boolean;
  /** Swap the sidebar between its two states. Absent when there is no sidebar. */
  onToggleSearch?: () => void;
  onNewFolder: () => void;
  onNewDoc: () => void;
  onCollapse?: () => void;
}) {
  const iconBtn =
    "rounded-md p-1.5 text-muted-foreground/80 transition hover:bg-muted hover:text-foreground disabled:opacity-50";
  // Icon-only buttons: the button opts out of the window-drag region, but its SVG
  // child doesn't inherit that, so a real click lands on the SVG and macOS drags
  // the window instead of firing onClick. Force the SVG to no-drag too.
  const noDrag = isDesktop
    ? "[-webkit-app-region:no-drag] [&_svg]:[-webkit-app-region:no-drag]"
    : "";
  return (
    <div
      className={cn(
        // Opaque, so it reads as one bar with the tab strip beside it, and the
        // bottom line continues across both. The column it sits in draws the
        // vertical line on its right; this row draws none of its own.
        "flex h-11 w-full shrink-0 items-center border-b bg-sidebar",
        !bare && "pr-2",
        isDesktop && "[-webkit-app-region:drag]"
      )}
    >
      {/* Reserve room for the macOS traffic lights on desktop. How much is the
          shell's to say: 76px when this header is at the window's left edge, less
          when the shell's own rail (and its cap) is there first — see the
          desktop app's dashboard page, which sets --traffic-light-inset. */}
      {isDesktop && <div className="w-[var(--traffic-light-inset,76px)] shrink-0" aria-hidden />}

      {!bare && (
        <>
          <div className="flex-1" />
          <div className={cn("flex items-center gap-0.5", noDrag)}>
            {/* Search lives here, beside the create actions, because it acts
                on the sidebar the same way they do — and as a toggle, so the
                thing it turns on has an obvious way back off. */}
            {onToggleSearch && (
              <button
                type="button"
                aria-label={searching ? "Show files" : "Search documents"}
                title={searching ? "Show files" : "Search documents"}
                aria-pressed={searching}
                onClick={onToggleSearch}
                className={cn(iconBtn, searching && "bg-muted text-foreground")}
              >
                <Search className="size-4" strokeWidth={1.5} />
              </button>
            )}
            {canCreate && (
              <>
                <button
                  type="button"
                  aria-label="New folder"
                  title="New folder"
                  onClick={onNewFolder}
                  disabled={creating}
                  className={iconBtn}
                >
                  <FolderPlus className="size-4" strokeWidth={1.5} />
                </button>
                <button
                  type="button"
                  aria-label="New document"
                  title="New document"
                  onClick={onNewDoc}
                  disabled={creating}
                  className={iconBtn}
                >
                  <FilePlus className="size-4" strokeWidth={1.5} />
                </button>
              </>
            )}
            {onCollapse && (
              <button
                type="button"
                aria-label="Collapse sidebar"
                title="Collapse sidebar (⌘\)"
                onClick={onCollapse}
                className={iconBtn}
              >
                <PanelLeftClose className="size-4" strokeWidth={1.5} />
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
