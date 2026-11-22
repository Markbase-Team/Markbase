import { agentJson, authenticateAgent, preflight } from "@/lib/agent-auth";
import { agentTools } from "@markbase/shared/docs/agent-tools";

export const runtime = "nodejs";

export function OPTIONS() {
  return preflight();
}

// GET — the tools an agent may call, as this server defines them now. The MCP
// server asks here when it starts, so its tools follow a deploy rather than a
// release of the CLI (see @markbase/docs/agent-tools).
export async function GET(req: Request) {
  const auth = await authenticateAgent(req, "read");
  if (!auth.ok) return agentJson({ error: auth.error }, auth.status);
  return agentJson({ tools: agentTools() });
}
