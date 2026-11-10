import type { FeatureLayoutProps } from "@markbase/ui/page-host";
import { getProject } from "@markbase/protocol/tickets";
import { ProjectProvider, ProjectTabs } from "../../../../ui";

// Shared shell for a project's asset tabs (Secrets, Work Logs): the tab bar +
// the per-project client-state provider. The provider persists across the asset
// tabs, so switching between them is instant and creates are optimistic.
export default async function ProjectLayout({
  params,
  children,
  host,
}: FeatureLayoutProps<{ slug: string }>) {
  const { slug } = await params;
  const ownerId = (await host.viewer())?.id ?? "";
  const project = await getProject(slug, ownerId);
  // `return` rather than a bare call: TS only narrows on a never-returning
  // call through an explicitly typed reference, and a destructured `host` is not.
  if (!project) return host.notFound();

  return (
    <ProjectProvider slug={project.slug}>
      <main className="flex h-svh w-full min-w-0 flex-col overflow-x-hidden">
        <ProjectTabs slug={project.slug} projectName={project.name} variant="header" />
        <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-3 pt-6">
          {children}
        </div>
      </main>
    </ProjectProvider>
  );
}
