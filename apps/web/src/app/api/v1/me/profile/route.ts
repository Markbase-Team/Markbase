import { agentJson, authenticateAgent, preflight } from "@/lib/agent-auth";
import { forgetOwnerName, getUserProfile, setUserDisplayName } from "@markbase/docs/server";

export const runtime = "nodejs";

export function OPTIONS() {
  return preflight();
}

/** What Settings sends. */
interface ProfileBody {
  display_name?: string;
}

// GET /api/v1/me/profile — the caller's display name: the one they chose, and
// the sign-in's name that is shown while they have chosen none.
export async function GET(req: Request) {
  const auth = await authenticateAgent(req, "read");
  if (!auth.ok) return agentJson({ error: auth.error }, auth.status);
  return agentJson(await getUserProfile(auth.ownerId));
}

// PUT /api/v1/me/profile { display_name } — set the name others see on
// published pages, versions and invitations. An empty string clears it, and
// the sign-in's name (if any) shows again.
export async function PUT(req: Request) {
  const auth = await authenticateAgent(req, "write");
  if (!auth.ok) return agentJson({ error: auth.error }, auth.status);
  let body: ProfileBody = {};
  try {
    body = (await req.json()) as ProfileBody;
  } catch {
    return agentJson({ error: "Expected a JSON body." }, 400);
  }
  if (typeof body.display_name !== "string") {
    return agentJson({ error: "display_name is required (an empty string clears it)." }, 400);
  }
  try {
    const profile = await setUserDisplayName(auth.ownerId, body.display_name);
    forgetOwnerName(auth.ownerId);
    return agentJson(profile);
  } catch (e) {
    return agentJson({ error: e instanceof Error ? e.message : "Could not save the name." }, 400);
  }
}
