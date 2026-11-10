import type { ShellRoutes } from "@markbase/ui/navigation";
// The generated module pulls in every shipped feature's ShellRoutes
// declarations, so the table below will not compile until it answers each one.
import type {} from "@/generated/feature-slots";

/**
 * Where this shell puts the pages features need to link to.
 *
 * The names come from the features themselves, via ShellRoutes; the paths are
 * this shell's. One table, used by the client navigation port and by the
 * server page host alike, so a feature's link means the same place whichever
 * side of the render asked.
 *
 * Declared as a plain object and then assigned, rather than written as a
 * `ShellRoutes` literal: a build that ships no feature declaring a route
 * leaves the interface empty, and a literal with keys an empty interface
 * does not name would fail to compile. The assignment still fails when a
 * shipped feature declares a key this table lacks, which is the check that
 * matters.
 */
const SHELL_ROUTES = {
  /** The board, optionally filtered to one project. */
  board: (slug?: string): string =>
    slug
      ? `/dashboard/projects?project=${encodeURIComponent(slug)}`
      : "/dashboard/projects",
  projectTab: (slug: string, tab: string): string =>
    `/dashboard/projects/${encodeURIComponent(slug)}/${tab}`,
  quickstart: (feature: string): string => `/dashboard/quickstart?feature=${feature}`,
  isBoard: (path: string): boolean => path === "/dashboard/projects",
  attention: (): string => "/dashboard/attention",
  skills: (): string => "/dashboard/skills",
  skill: (id: string): string => `/dashboard/skills/${encodeURIComponent(id)}`,
  apiKeys: (): string => "/dashboard/api-keys",
};

export const shellRoutes: ShellRoutes = SHELL_ROUTES;
