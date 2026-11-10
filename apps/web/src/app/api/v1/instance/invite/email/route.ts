import { agentJson, authenticateAgent, preflight } from "@/lib/agent-auth";
import { addInvite, inviteInfo, removeInvite } from "@/lib/invite";

export const runtime = "nodejs";

export function OPTIONS() {
  return preflight();
}

/** What Settings sends: the address to add or withdraw. */
interface EmailBody {
  email?: string;
}

async function readEmail(req: Request): Promise<string | null> {
  let body: EmailBody = {};
  try {
    body = (await req.json()) as EmailBody;
  } catch {
    return null;
  }
  return typeof body.email === "string" && body.email.trim() ? body.email : null;
}

// POST /api/v1/instance/invite/email { email } — put an address on the invite
// list. Nothing is sent; the member hands the teammate the join link, and the
// join page then creates an account for that address. Any member may, like
// sharing the link. Answers with the list and the link, for Settings to show.
export async function POST(req: Request) {
  const auth = await authenticateAgent(req, "write");
  if (!auth.ok) return agentJson({ error: auth.error }, auth.status);
  const email = await readEmail(req);
  if (!email) return agentJson({ error: "An email address is required." }, 400);
  const added = await addInvite(email, auth.ownerId);
  if (!added.ok) return agentJson({ error: added.error }, 400);
  return agentJson(await inviteInfo(auth.ownerId));
}

// DELETE /api/v1/instance/invite/email { email } — take an address off the
// list before it joins. One that already joined is an account, not an invite.
export async function DELETE(req: Request) {
  const auth = await authenticateAgent(req, "write");
  if (!auth.ok) return agentJson({ error: auth.error }, auth.status);
  const email = await readEmail(req);
  if (!email) return agentJson({ error: "An email address is required." }, 400);
  await removeInvite(email);
  return agentJson(await inviteInfo(auth.ownerId));
}
