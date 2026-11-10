import { redirect } from "next/navigation";
import { SIGNED_IN_HOME } from "@/lib/routes";

// The dashboard's home is Documents. The board used to be rendered here when a
// project or a view was named in the query; it is the projects feature's page
// now (/dashboard/projects, contributed through that package's manifest), so a
// build without projects has no board and this file has nothing to import.
export default function DashboardPage() {
  redirect(SIGNED_IN_HOME);
}
