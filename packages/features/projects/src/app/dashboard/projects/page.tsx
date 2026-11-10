import type { FeaturePageProps } from "@markbase/ui/page-host";
import { getProject, listTickets } from "@markbase/protocol/tickets";
import { AdminClient } from "../../../ui";

// The board. This IS the projects surface now — a bare /dashboard lands on
// Documents in the shell, and the board lives one segment deeper, filtered by
// ?project= and ?view= the way the sidebar links to it.
export default async function BoardPage({
  searchParams,
  host,
}: FeaturePageProps<object, { project?: string; view?: string }>) {
  const { project } = await searchParams;
  const user = await host.viewer();
  const ownerId = user?.id ?? "";
  // Only honor a known project slug (owned by this user) from the sidebar links.
  const initialProject =
    project && (await getProject(project, ownerId)) ? project : undefined;

  // Load ALL of this user's tickets once; the board filters/sorts client-side,
  // so switching projects is an in-memory recompute (no fetch). Seeded
  // server-side to avoid a flash on first paint.
  const tickets = await listTickets(ownerId, {});

  return (
    <AdminClient
      initialTickets={tickets}
      initialProject={initialProject}
      // A ticket the owner opens in the workspace is requested by them — no need
      // to type their own name.
      userEmail={user?.email ?? ""}
    />
  );
}
