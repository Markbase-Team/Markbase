import type { SidebarEntry } from "./schema";

// The half of this package that runs in the app, as opposed to in the build.
//
// **No filesystem, no node builtins.** The manifests live in the monorepo's
// `packages/` directory, which is not deployed — a serverless function has no
// such tree to read, and a browser bundle certainly does not. So the build
// reads them once (see web.ts), inlines the result through Next's `env`, and
// everything at request time parses that string instead.
//
// Import this module, never the package barrel, from app code: the barrel
// re-exports the loader, which reaches for node:fs.

/** One feature, as inlined into the build. */
export interface FeatureRuntime {
  id: string;
  sidebar: SidebarEntry[];
}

/**
 * Read the feature set the build inlined.
 *
 * Returns `[]` when the variable is missing or malformed rather than throwing:
 * this runs while rendering the dashboard shell, and a sidebar with no feature
 * entries is a far better failure than a page that will not render at all. A
 * genuinely wrong feature set is caught at build time, where it belongs.
 */
export function parseFeatures(raw: string | undefined): FeatureRuntime[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as FeatureRuntime[]) : [];
  } catch {
    return [];
  }
}

/**
 * The sidebar entries this build shows — every entry of every feature it
 * shipped. What is in a build is the only gate: a feature that is not
 * released is not in the build at all (see `enabledFeatures`), and one that
 * is belongs to everyone who signs in.
 *
 * Order follows the inlined list, which the build sorted by feature id, so the
 * sidebar does not reshuffle between deploys.
 */
export function visibleSidebar(features: FeatureRuntime[]): SidebarEntry[] {
  return features.flatMap((f) => f.sidebar);
}

/** Whether this build shipped a given feature. Drives the route guard. */
export function featureEnabled(
  features: FeatureRuntime[],
  id: string
): boolean {
  return features.some((f) => f.id === id);
}

/**
 * Whether a path belongs to a feature this build left out.
 *
 * Prefix match on a path boundary: "/dashboard/attention" must block
 * "/dashboard/attention/x" but never "/dashboard/attention-training", which is
 * a different page that happens to share a stem.
 */
export function isDisabledRoute(
  disabledPrefixes: string[],
  pathname: string
): boolean {
  return disabledPrefixes.some(
    (p) => pathname === p || pathname.startsWith(p.endsWith("/") ? p : `${p}/`)
  );
}

/** Parse the inlined disabled-route list. Empty on anything unexpected. */
export function parseDisabledRoutes(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as string[]) : [];
  } catch {
    return [];
  }
}
