import { agentJson, authenticateAgent, preflight } from "@/lib/agent-auth";
import { inviteInfo, rotateInviteCode } from "@/lib/invite";

export const runtime = "nodejs";

export function OPTIONS() {
  return preflight();
}

// POST /api/v1/instance/invite/rotate — a new invite code. Every link carrying
// the old one stops admitting people; this is how a leaked link is revoked.
export async function POST(req: Request) {
  const auth = await authenticateAgent(req, "write");
  if (!auth.ok) return agentJson({ error: auth.error }, auth.status);
  await rotateInviteCode();
  return agentJson(await inviteInfo(auth.ownerId));
}
