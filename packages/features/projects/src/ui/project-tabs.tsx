"use client";

import { useNavigation } from "@markbase/ui/navigation";
import type {} from "./routes";
import { BookText, KanbanSquare, KeyRound, NotebookText, Plug } from "lucide-react";
import { cn } from "@markbase/ui/utils";
import { AppHeader, headerNoDrag } from "@markbase/ui/app-header";
import { PageHeader } from "@markbase/ui/page-header";
import { TabBar } from "@markbase/ui/tab-bar";

export type ProjectTab = "board" | "secrets" | "work-logs" | "docs" | "mcp";

// Secondary navigation across a project's assets (the board + per-project
// Secrets and Work Logs). Shown at the top of the project view. `active` may be
// passed explicitly (the board sets "board"); otherwise it's derived from the
// path (used by the project asset layout).
export function ProjectTabs({
  slug,
  active,
  projectName,
  variant = "bar",
}: {
  slug: string;
  active?: ProjectTab;
  projectName?: string;
  /** "header" renders inside the unified AppHeader (the project asset pages);
   *  "bar" keeps the in-content PageHeader row (the board). */
  variant?: "bar" | "header";
}) {
  const { pathname, routes } = useNavigation();
  const resolvedActive: ProjectTab =
    active ??
    (pathname.endsWith("/secrets")
      ? "secrets"
      : pathname.endsWith("/work-logs")
        ? "work-logs"
        : pathname.endsWith("/docs")
          ? "docs"
          : pathname.endsWith("/mcp")
            ? "mcp"
            : "board");
  const tabs: { key: ProjectTab; label: string; href: string; Icon: typeof KanbanSquare }[] =
    [
      {
        key: "board",
        label: "Board",
        href: routes.board(slug),
        Icon: KanbanSquare,
      },
      {
        key: "secrets",
        label: "Secrets",
        href: routes.projectTab(slug, "secrets"),
        Icon: KeyRound,
      },
      {
        key: "work-logs",
        label: "Work Logs",
        href: routes.projectTab(slug, "work-logs"),
        Icon: NotebookText,
      },
      {
        key: "docs",
        label: "Docs",
        href: routes.projectTab(slug, "docs"),
        Icon: BookText,
      },
      {
        key: "mcp",
        label: "MCP",
        href: routes.projectTab(slug, "mcp"),
        Icon: Plug,
      },
    ];

  return (
    variant === "header" ? (
      <AppHeader title={projectName}>
        <TabBar
          tabs={tabs}
          activeKey={resolvedActive}
          className={cn("min-w-0 flex-1", headerNoDrag)}
        />
      </AppHeader>
    ) : (
      <PageHeader>
        {projectName && (
          <span className="hidden shrink-0 pr-1 text-sm font-semibold sm:inline">
            {projectName}
          </span>
        )}
        <TabBar tabs={tabs} activeKey={resolvedActive} />
      </PageHeader>
    )
  );
}
