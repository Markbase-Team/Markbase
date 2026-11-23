"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import type { Project } from "@markbase/shared/types";

type ProjectsContextValue = {
  projects: Project[];
  // Optimistic mutations — the sidebar and board share this list, so a created
  // or renamed project shows everywhere instantly (no router.refresh).
  addProject: (p: Project) => void;
  patchProject: (slug: string, p: Project) => void;
  removeProject: (slug: string) => void;
};

const Ctx = createContext<ProjectsContextValue | null>(null);

export function useProjects(): ProjectsContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) {
    throw new Error("useProjects must be used within <ProjectsProvider>");
  }
  return ctx;
}

const byName = (a: Project, b: Project) => a.name.localeCompare(b.name);

// Holds the shared projects list for the whole dashboard (sidebar + board +
// project pages); persists across client navigation since the layout doesn't
// remount.
//
// `initialProjects` is the list as the host loaded it, and it can arrive after
// the first render: ProjectsRoot mounts with none and fetches them. So a new
// list from the host replaces what is held here. Reading it only once left
// the board with no projects for ever, and "New ticket" disabled.
export function ProjectsProvider({
  initialProjects,
  children,
}: {
  initialProjects: Project[];
  children: React.ReactNode;
}) {
  const [projects, setProjects] = useState<Project[]>(initialProjects);
  const [seed, setSeed] = useState<Project[]>(initialProjects);
  if (seed !== initialProjects) {
    setSeed(initialProjects);
    setProjects(initialProjects);
  }

  const addProject = useCallback((p: Project) => {
    setProjects((prev) =>
      [...prev.filter((x) => x.slug !== p.slug), p].sort(byName)
    );
  }, []);

  const patchProject = useCallback((slug: string, p: Project) => {
    setProjects((prev) =>
      prev.map((x) => (x.slug === slug ? p : x)).sort(byName)
    );
  }, []);

  const removeProject = useCallback((slug: string) => {
    setProjects((prev) => prev.filter((x) => x.slug !== slug));
  }, []);

  const value = useMemo(
    () => ({ projects, addProject, patchProject, removeProject }),
    [projects, addProject, patchProject, removeProject]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
