import { getProject } from "@markbase/protocol";
import { createAgentSession, createAgentSpawnRequest, listAgentSessions, isProvider } from "@markbase/protocol";
import { listApiKeys } from "@markbase/node";
import { CLAUDE_CODE_REQUIRED, featureEnabled } from "@markbase/node/features";
import { callerFromHeaders } from "@markbase/protocol/auth";

// Authentication happens in the shell's proxy — /api/v1/agent-sessions is a
// `required` prefix there, so a request that reaches this file carries a
// caller. The check below is what makes that assumption visible.

// GET /api/v1/agent-sessions — the owner's agent sessions (for the Agents page)
// plus whether they can actually be dispatched to. Every assignee picker already
// reads this, so the flag rides along rather than being drilled through props.
export async function GET(req: Request) {
  const caller = callerFromHeaders(req.headers);
  if (!caller) return Response.json({ error: "Missing credentials." }, { status: 401 });
  const [sessions, canDispatch] = await Promise.all([
    listAgentSessions(caller.ownerId),
    featureEnabled("ticketDispatch", caller.ownerId),
  ]);
  return Response.json({ sessions, canDispatch });
}

// POST /api/v1/agent-sessions  { provider, name } — register a pending agent
// slot. Returns the session incl. its session_token (shown once, wired into the
// agent's MCP config so its doc actions attribute to this session).
export async function POST(req: Request) {
  const caller = callerFromHeaders(req.headers);
  if (!caller) return Response.json({ error: "Missing credentials." }, { status: 401 });
  // Creating a session queues a spawn — the worker launches `claude` for it.
  if (!(await featureEnabled("ticketDispatch", caller.ownerId))) {
    return Response.json({ error: CLAUDE_CODE_REQUIRED }, { status: 403 });
  }

  let body: { provider?: string; name?: string; project?: string } = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return Response.json({ error: "name is required" }, { status: 400 });
  if (!isProvider(body.provider)) {
    return Response.json({ error: "Unknown provider" }, { status: 400 });
  }

  // Link to an existing connection of that provider when the user has one.
  const conn = (await listApiKeys(caller.ownerId)).find((k) => k.provider === body.provider);
  const session = await createAgentSession({
    ownerId: caller.ownerId,
    name,
    provider: body.provider,
    connectionId: conn?.id ?? null,
  });

  // Worker auto-spawn: Claude Code + a project with a local repo → ask the local
  // worker to launch the session. Otherwise it's register-and-claim (the caller
  // wires the token). Only spawns when the project resolves to a local path.
  let spawning = false;
  const projectSlug = typeof body.project === "string" ? body.project.trim() : "";
  if (body.provider === "claude_code" && projectSlug) {
    const project = await getProject(projectSlug, caller.ownerId);
    if (project?.local_path) {
      await createAgentSpawnRequest({
        ownerId: caller.ownerId,
        agentSessionId: session.id,
        project: project.slug,
        prompt: `Hi, your name is ${name}`,
      });
      spawning = true;
    }
  }

  return Response.json({ session, spawning }, { status: 201 });
}
