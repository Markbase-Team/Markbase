import { DEFAULT_APP_URL } from "@markbase/protocol/instance";
import { agentJson, preflight } from "@/lib/agent-auth";
import { instanceUrl } from "@/lib/instance-url";
import { createInvitedUser, instanceHasAccounts, isInvited, verifyInviteCode } from "@/lib/invite";

export const runtime = "nodejs";

export function OPTIONS() {
  return preflight();
}

/** What the join page sends. */
interface JoinBody {
  code?: string;
  email?: string;
  password?: string;
}

// POST /api/v1/instance/join — create an account on this instance. Public,
// like the pages that call it. Two gates: the code the join link carries, and
// the address — a member put it on the invite list (Settings → Invite your
// team) before handing the link over. The one exception is a fresh instance:
// its first account has nobody to invite it, so until one exists the sign-up
// is open, needs no code, and the account it creates is the admin.
//
// Not on the hosted app, whose sign-up is open at /signup; a team instance's
// is this, and only this, once its Supabase project has public sign-up turned
// off (SELF-HOSTING.md).
export async function POST(req: Request) {
  if ((await instanceUrl()) === DEFAULT_APP_URL) {
    return agentJson({ error: "The hosted app signs people up at /signup" }, 404);
  }
  let body: JoinBody = {};
  try {
    body = (await req.json()) as JoinBody;
  } catch {
    return agentJson({ error: "Expected a JSON body" }, 400);
  }
  const email = body.email?.trim() ?? "";
  const password = body.password ?? "";
  if (!email || !password) return agentJson({ error: "Email and password are required" }, 400);
  // An empty instance admits its first account with no code at all: there is
  // nobody to have issued one, and that account becomes the admin.
  const first = !(await instanceHasAccounts());
  if (!first) {
    if (!(await verifyInviteCode(body.code?.trim()))) {
      return agentJson({ error: "That invite link is not valid any more. Ask a teammate for a new one." }, 403);
    }
    if (!(await isInvited(email))) {
      return agentJson(
        { error: "That address has not been invited. Ask a teammate to add it under Settings → Invite your team." },
        403
      );
    }
  }
  const created = await createInvitedUser(email, password, first);
  if (!created.ok) return agentJson({ error: created.error }, 400);
  return agentJson({ ok: true });
}
