"use client";

import { useEffect, useState } from "react";
import type { Project } from "@markbase/protocol/types";
import { ProjectsProvider } from "./projects-context";

/**
 * The projects list, mounted by the shell without the shell knowing what it is.
 *
 * The dashboard layout used to fetch `listProjects` server-side and wrap the
 * tree in ProjectsProvider itself — which meant a release that dropped this
 * feature would not compile. The layout now wraps whatever the manifests
 * contributed, and this supplies its own data.
 *
 * The cost of that is the list arriving a moment after first paint instead of
 * with it. The sidebar already fills in progressively — the running-indicator
 * dots load the same way — so the entry is there from the start and only its
 * children arrive late.
 */
export default function ProjectsRoot({ children }: { children: React.ReactNode }) {
  const [projects, setProjects] = useState<Project[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/projects")
      .then((r) => (r.ok ? r.json() : { projects: [] }))
      .then((d: { projects?: Project[] }) => {
        if (!cancelled) setProjects(d.projects ?? []);
      })
      .catch(() => {
        // The sidebar is not worth the dashboard: render with none.
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return <ProjectsProvider initialProjects={projects}>{children}</ProjectsProvider>;
}
