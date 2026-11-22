"use client";

import type { ComponentType, ReactNode } from "react";
import {
  Bell,
  Bot,
  BookA,
  BookOpenText,
  FileText,
  FolderKanban,
  NotebookPen,
  Sparkles,
  Sun,
} from "lucide-react";
import { ComingSoonBadge } from "./coming-soon";
import { useNavigation } from "./navigation";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "./sidebar";
import type { SidebarSlotMap, SidebarSlotProps } from "./sidebar-slot";
import { useIsDesktop } from "./use-is-desktop";
import { cn } from "./utils";

// The app's main sidebar — the icon rail every feature sits beside.
//
// This is shell chrome, not a feature's: it lists what the build shipped and
// is the same wherever the app is mounted. Both shells render it — the website
// around its dashboard pages, the desktop app around the surfaces it draws
// itself — so it lives here, with the shells supplying only what differs:
// which entries they can open, the per-feature sidebar sections the web
// generates per build, and the footer (the web's signed-in user with Settings
// and Log out; the desktop's with its sign-in).
//
// Navigation goes through the port (@markbase/ui/navigation), so this knows
// neither Next's Link nor the desktop's pushState — each shell's provider does.

/** One entry, as a feature's manifest declares it. */
export type RailEntry = SidebarSlotProps["entry"];

// A manifest names its icon as a string, because JSON cannot hold a component.
// This is the whole mapping — deliberately explicit rather than a namespace
// import of lucide, which would pull every icon into the bundle to use two. A
// name with no entry here renders as text only.
export const FEATURE_ICONS: Record<string, ComponentType<{ className?: string }>> = {
  Bell,
  BookA,
  BookOpenText,
  Bot,
  FileText,
  FolderKanban,
  NotebookPen,
  Sparkles,
  Sun,
};

export function AppRail({
  entries,
  available,
  slots = {},
  footer,
  children,
}: {
  /** Contributed by the features this build shipped, already filtered for the viewer. */
  entries: RailEntry[];
  /**
   * The entry ids this shell can open. Omitted, every entry is a link. Given,
   * the rest are still listed — so the app reads the same everywhere — but
   * cannot be clicked, and carry a "Coming soon" tag.
   */
  available?: ReadonlySet<string>;
  /** A feature's own sidebar section, keyed by entry id, where a plain row is not enough. */
  slots?: SidebarSlotMap;
  /** The footer row — the signed-in user, in whatever form this shell has. */
  footer?: ReactNode;
  /** Rendered inside the sidebar after everything else: dialogs the footer opens. */
  children?: ReactNode;
}) {
  const { Link } = useNavigation();
  const isDesktop = useIsDesktop();
  // Desktop and web alike: the sidebar sits collapsed to an icon rail and
  // expands (as an overlay) only while hovered. Below the md breakpoint it is
  // still that rail (`mobile="rail"`), not a drawer: a window made narrow used
  // to lose its main navigation outright, when all it should lose is the
  // labels. Mouse events don't fire on touch, so hover is a no-op there and
  // the icons are what a phone gets.
  const { setOpen, isMobile } = useSidebar();

  return (
    <>
      {/* The rail's top cap: the header-height strip above the rail, which
          itself starts below --app-header-h so the page's header row runs
          across the top. The shell that owns the rail caps it; a feature's
          header beside it is that feature's own width and never reaches over.
          On desktop the macOS traffic lights sit on this square, so it is also
          part of the window's drag region. Shown at every width, like the rail. */}
      <div
        aria-hidden
        className={cn(
          "fixed top-0 left-0 z-10 block h-[var(--app-header-h,0px)] w-(--sidebar-width-icon) border-b bg-sidebar",
          isDesktop ? "[-webkit-app-region:drag]" : "pointer-events-none"
        )}
      />
      <Sidebar
        collapsible="icon"
        hoverExpand
        mobile="rail"
        onMouseEnter={isMobile ? undefined : () => setOpen(true)}
        onMouseLeave={isMobile ? undefined : () => setOpen(false)}
        // Lighten + un-bold every nav label (top items, project sub-items,
        // footer) — they darken to full colour on hover.
        className="[&_[data-sidebar=menu-button]]:font-normal [&_[data-sidebar=menu-button]]:text-muted-foreground [&_[data-sidebar=menu-sub-button]]:font-normal [&_[data-sidebar=menu-sub-button]]:text-muted-foreground"
      >
        {/* No brand header — the rail starts below the full-width header row
            (its fixed top is offset by --app-header-h), so its nav sits at the
            top with no inset. No active-item highlight either, by choice. */}
        <SidebarContent className="flex-none">
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {entries.map((entry) => {
                  const Icon = FEATURE_ICONS[entry.icon];
                  const enabled = !available || available.has(entry.id);
                  // A feature may supply its own section — a list, an action,
                  // live state — where this shell can open it.
                  const Slot = slots[entry.id];
                  if (Slot && enabled) return <Slot key={entry.id} entry={entry} Icon={Icon} />;
                  if (!enabled) {
                    return (
                      <SidebarMenuItem key={entry.id}>
                        {/* Not `disabled`: a disabled button swallows the pointer
                            events the tooltip needs, and the collapsed rail has
                            nothing else to say what the icon is. */}
                        <SidebarMenuButton
                          aria-disabled="true"
                          tooltip={`${entry.title} — coming soon`}
                          className="cursor-default opacity-60 hover:bg-transparent hover:text-muted-foreground active:bg-transparent"
                        >
                          {Icon ? <Icon /> : null}
                          <span>{entry.title}</span>
                          <ComingSoonBadge className="ml-auto group-data-[collapsible=icon]:hidden" />
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  }
                  return (
                    <SidebarMenuItem key={entry.id}>
                      <SidebarMenuButton asChild tooltip={entry.title}>
                        <Link href={entry.href}>
                          {Icon ? <Icon /> : null}
                          <span>{entry.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        {/* Everything below the nav, down through the footer. The divider is
            the footer's border-t (uses --border). */}
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1" />
          {footer && <SidebarFooter className="border-t">{footer}</SidebarFooter>}
        </div>

        {children}

        {/* Edge rail: click (or ⌘/Ctrl+B) to collapse to icons and back. */}
        <SidebarRail />
      </Sidebar>
    </>
  );
}
