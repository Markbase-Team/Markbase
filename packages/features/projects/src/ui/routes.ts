/**
 * Where this feature's pages live — named, not spelled out.
 *
 * The package builds no URLs itself. It says "the Secrets tab of this project"
 * and the shell answers with whatever that means there, so a desktop shell
 * routing on other paths reuses these components unchanged.
 *
 * Declared by augmenting core's empty ShellRoutes rather than by a projects-
 * specific context: the sidebar section and the projects provider are mounted
 * by the generated slot map, which passes no props and cannot carry one.
 */
export type ProjectTab = "secrets" | "work-logs" | "docs" | "mcp";

declare module "@markbase/ui/navigation" {
  interface ShellRoutes {
    /** The board, optionally filtered to one project. */
    board(projectSlug?: string): string;
    /** One of a project's tabs. */
    projectTab(slug: string, tab: ProjectTab): string;
    /** The page explaining how to unlock a Claude-Code-only feature. */
    quickstart(feature: string): string;
    /** Whether this path is the board itself — where project switching is local. */
    isBoard(pathname: string): boolean;
  }
}

export {};
