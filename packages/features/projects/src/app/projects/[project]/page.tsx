import type { FeaturePageProps } from "@markbase/ui/page-host";
import { getProjectBySlug, listProjectTickets } from "@markbase/protocol/tickets";
import { ProjectClient } from "../../../ui";

// Public requester view of a project — scoped to the project in the URL (no
// signed-in user; the project slug is the scope). Rendered per request: the
// manifest entry carries `dynamic: "force-dynamic"`, which the generated stub
// exports.
export default async function ProjectPage({
  params,
  host,
}: FeaturePageProps<{ project: string }>) {
  const { project } = await params;
  const proj = await getProjectBySlug(project);
  // `return` rather than a bare call: TS only narrows on a never-returning
  // call through an explicitly typed reference, and a destructured `host` is not.
  if (!proj) return host.notFound();

  const tickets = await listProjectTickets(project);
  return <ProjectClient project={proj} initialTickets={tickets} />;
}
