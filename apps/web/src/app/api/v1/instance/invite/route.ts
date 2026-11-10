import { agentJson, authenticateAgent, preflight } from "@/lib/agent-auth";
import { inviteInfo } from "@/lib/invite";

export const runtime = "nodejs";

export function OPTIONS() {
  return preflight();
}

// GET /api/v1/instance/invite — the instance's join link, for anyone signed in.
//
// Any member may invite: there is no admin role yet, and a team instance is a
// team. The desktop app asks with its key, the website with its session; a
// stranger gets nothing, which is the point of a code the page carries.
export async function GET(req: Request) {
  const auth = await authenticateAgent(req, "read");
  if (!auth.ok) return agentJson({ error: auth.error }, auth.status);
  return agentJson(await inviteInfo(auth.ownerId));
}
