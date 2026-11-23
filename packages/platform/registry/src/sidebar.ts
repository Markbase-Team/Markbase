import type { LoadedFeature } from "./load";
import type { SidebarEntry } from "./schema";

/**
 * The sidebar entries an enabled feature set contributes.
 *
 * Pure and data-in/data-out: a server component calls this and passes the
 * result to the client sidebar as props. The loader it is fed reaches the
 * filesystem, so nothing here may be imported by a `"use client"` file.
 *
 * Order follows feature id, which `loadFeatures` already sorts by, so the
 * sidebar does not reshuffle between builds.
 */
export function sidebarEntries(features: LoadedFeature[]): SidebarEntry[] {
  return features.flatMap((f) => f.manifest.sidebar);
}
