"use client";

import { useEffect, useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { createSupabaseBrowserClient } from "@markbase/protocol/browser";
import { useNavigation } from "@markbase/ui/navigation";
import type {} from "./routes";
import type { SidebarSlotProps } from "@markbase/ui/sidebar-slot";
import {
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@markbase/ui/sidebar";
import { useProjects } from "./projects-context";

/**
 * The projects entry in the shell's sidebar.
 *
 * This used to live inside AppSidebar behind `if (entry.id === "projects")`,
 * which made the shell subscribe to the tickets table, know what a project is,
 * and fail to compile in a release that dropped this feature. It is the
 * feature's own UI and belongs here; the shell renders whatever the slot map
 * gives it for an entry, or a plain link when there is nothing.
 */
export default function ProjectsSidebar({ entry, Icon }: SidebarSlotProps) {
  const { projects } = useProjects();
  const { pathname, Link, routes } = useNavigation();

  // Project slugs with a Claude Code run in flight — the green dot. Kept live
  // via Realtime so it updates on any page, not only the board. The shell used
  // to own this subscription, for a table it has no other reason to know about.
  const [runningSlugs, setRunningSlugs] = useState<Set<string>>(new Set());
  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    let cancelled = false;
    async function loadRunning() {
      const { data } = await supabase
        .from("tickets")
        .select("project")
        .eq("cc_state", "running");
      if (cancelled) return;
      setRunningSlugs(
        new Set((data ?? []).map((r: { project: string }) => r.project))
      );
    }
    loadRunning();
    const channel = supabase
      .channel("sidebar-running")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tickets" },
        () => loadRunning()
      )
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, []);

  // On the board, switch projects client-side (the board listens for this and
  // updates the filter + URL without a server round-trip). Elsewhere, let the
  // link navigate to the board normally.
  function onProjectClick(e: React.MouseEvent, slug: string) {
    if (routes.isBoard(pathname)) {
      e.preventDefault();
      window.dispatchEvent(
        new CustomEvent("select-project", { detail: { slug } })
      );
    }
  }

  return (
    <SidebarMenuItem key={entry.id}>
      <SidebarMenuButton asChild tooltip={entry.title}>
        <Link href={entry.href} onClick={(e) => onProjectClick(e, "")}>
          {Icon ? <Icon /> : null}
          <span>{entry.title}</span>
        </Link>
      </SidebarMenuButton>
      <SidebarMenuAction
        onClick={() =>
          window.dispatchEvent(new CustomEvent("new-project"))
        }
        title="New project"
        aria-label="New project"
      >
        <Plus />
      </SidebarMenuAction>
      {projects.length > 0 && (
        <SidebarMenuSub>
          {projects.map((p) => (
            <SidebarMenuSubItem key={p.slug}>
              <SidebarMenuSubButton asChild className="pr-7">
                <Link
                  href={routes.board(p.slug)}
                  onClick={(e) => onProjectClick(e, p.slug)}
                >
                  <span className="truncate">{p.name}</span>
                  {runningSlugs.has(p.slug) && (
                    <span
                      className="ml-auto size-2 shrink-0 animate-pulse rounded-full bg-emerald-500"
                      title="Running"
                      aria-label="Has a running ticket"
                    />
                  )}
                </Link>
              </SidebarMenuSubButton>
              <button
                type="button"
                title="Edit project"
                aria-label="Edit project"
                onClick={() =>
                  window.dispatchEvent(
                    new CustomEvent("edit-project", {
                      detail: { slug: p.slug },
                    })
                  )
                }
                className="absolute top-1 right-1 flex aspect-square w-5 items-center justify-center rounded-md text-sidebar-foreground opacity-0 transition-opacity group-hover/menu-sub-item:opacity-100 focus-visible:opacity-100 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-hidden [&>svg]:size-3.5"
              >
                <Pencil />
              </button>
            </SidebarMenuSubItem>
          ))}
        </SidebarMenuSub>
      )}
    </SidebarMenuItem>
  );
}
