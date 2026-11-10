"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import type { Project } from "@markbase/protocol/types";

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
// project pages). Seeded from the server in the dashboard layout; persists
// across client navigation since the layout doesn't remount.
export function ProjectsProvider({
  initialProjects,
  children,
}: {
  initialProjects: Project[];
  children: React.ReactNode;
}) {
  const [projects, setProjects] = useState<Project[]>(initialProjects);

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
