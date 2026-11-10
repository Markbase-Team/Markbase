import type { FeaturePageProps } from "@markbase/ui/page-host";
import { WorkLogsClient } from "../../../../../ui";

// The project layout provides the shell (tab bar + scroll container + the
// per-project state provider); this page just renders the work-logs content.
export default function ProjectWorkLogsPage(_: FeaturePageProps) {
  return <WorkLogsClient />;
}
