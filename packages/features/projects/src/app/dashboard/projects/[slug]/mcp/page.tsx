import type { FeaturePageProps } from "@markbase/ui/page-host";
import { McpClient } from "../../../../../ui";

// The project layout provides the shell (tab bar + scroll container + provider);
// this page renders the MCP config editor.
export default function ProjectMcpPage(_: FeaturePageProps) {
  return <McpClient />;
}
