import { toolsFrom, type AgentTool } from "../endpoint-tools";
import { AGENT_ENDPOINTS } from "./endpoints";

// The tools this server offers agents: every endpoint in the registry that is
// not hidden from them. What a tool is, and how one is read back from a
// server's answer, is shared by every feature (@markbase/shared/endpoint-tools).

export {
  AGENT_TOOLS_PATH,
  parseAgentTools,
  pathParams,
  toolInputSchema,
  type AgentTool,
  type ToolInputSchema,
  type ToolProperty,
} from "../endpoint-tools";

/** Every tool, from the endpoint registry as this build has it. */
export function agentTools(): AgentTool[] {
  return toolsFrom(AGENT_ENDPOINTS);
}
