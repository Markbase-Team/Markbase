// What a shell mounts. The board is the projects surface; the rest are the
// pages that hang off a single project, plus the public request form.
export { AdminClient } from "./board";
export { ProjectsProvider, useProjects } from "./projects-context";
export { ProjectProvider, useProject } from "./project-context";
export { ProjectTabs } from "./project-tabs";
export { McpClient } from "./mcp-client";
export { WorkLogsClient } from "./work-logs-client";
export { DocsClient } from "./docs-client";
export { ProjectClient } from "./public-project";
export type { Secret } from "./project-context";
