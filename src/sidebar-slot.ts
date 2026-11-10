import type { ComponentType } from "react";

/**
 * A feature's own sidebar entry, when a plain link is not enough.
 *
 * Most features want one row: an icon, a title, a href. The manifest says so
 * and the shell renders it. A few want more — the projects entry carries a list
 * of projects, a "new project" action, and a live running-indicator fed by a
 * Realtime subscription.
 *
 * Before this, the shell rendered that itself, behind
 * `if (entry.id === "projects")`. Three things followed from that one line: the
 * shell subscribed to the tickets table, the shell knew what a project was, and
 * a release that dropped projects would not compile. A feature supplying its
 * own section removes all three.
 *
 * The slot map is generated per build from the manifests, so a feature left out
 * contributes nothing and is never imported.
 */
export interface SidebarSlotProps {
  /** The entry as the manifest declared it. */
  entry: {
    id: string;
    title: string;
    href: string;
    icon: string;
  };
  /** The resolved lucide icon, already chosen by the shell. */
  Icon?: ComponentType<{ className?: string }>;
}

export type SidebarSlot = ComponentType<SidebarSlotProps>;

/** id → the feature's section. Generated; see apps/web/scripts/gen-feature-slots.ts. */
export type SidebarSlotMap = Record<string, SidebarSlot>;
