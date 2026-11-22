import {
  createAgentSession,
  createAgentSpawnRequest,
  endAgentSession,
  getProject,
  isProvider,
  listAgentSessions,
  renameAgentSession,
} from "@markbase/protocol";
import { endpointSet, signedIn, type EndpointDef } from "@markbase/protocol/endpoint";
import { listApiKeys } from "@markbase/server/api-keys";
import { CLAUDE_CODE_REQUIRED, featureEnabled } from "@markbase/server/features";

// The agents feature's endpoints: the named agent sessions a person hands work
// to. Each is written once — what it is, who may call it, its code — with the
// machinery every feature shares (@markbase/protocol/endpoint); the route files
// under src/app/api are generated from these (scripts/gen-endpoints.ts).
//
// Authentication happens in the shell's proxy — /api/v1/agent-sessions is a
// `required` prefix there — and `signedIn` is what makes that assumption
// visible: a request with no caller attached is refused here too.

const agents = endpointSet<EndpointDef>("agents");

/** Every agents endpoint, in the order they are defined. */
export const definedEndpoints = agents.defined;
/** The route handler for one agents endpoint, as a route file exports it. */
export const agentsRoute = agents.route;

/**
 * Why none of these is an agent's tool yet: sessions are how a PERSON hands
 * out work, and an agent creating, renaming or ending them is managing the
 * roster it is itself an entry on.
 */
const NOT_FOR_AGENTS_YET =
  "Not offered to agents yet: agent sessions are created, renamed and ended by the person handing out the work.";

// GET /api/v1/agent-sessions — the owner's agent sessions (for the Agents page)
// plus whether they can actually be dispatched to. Every assignee picker already
// reads this, so the flag rides along rather than being drilled through props.
export const listSessionsEndpoint = agents.define(
  {
    id: "agents_listSessions",
    method: "GET",
    path: "/agent-sessions",
    scope: "read",
    summary: "List your agent sessions, and whether work can be dispatched to them",
    humanOnly: true,
    why: NOT_FOR_AGENTS_YET,
  },
  signedIn,
  async (_req, _params, caller) => {
    const [sessions, canDispatch] = await Promise.all([
      listAgentSessions(caller.ownerId),
      featureEnabled("ticketDispatch", caller.ownerId),
    ]);
    return Response.json({ sessions, canDispatch });
  }
);

// POST /api/v1/agent-sessions  { provider, name } — register a pending agent
// slot. Returns the session incl. its session_token (shown once, wired into the
// agent's MCP config so its doc actions attribute to this session).
export const createSessionEndpoint = agents.define(
  {
    id: "agents_createSession",
    method: "POST",
    path: "/agent-sessions",
    scope: "write",
    params: [
      { name: "name", type: "string", required: true, description: "What the session is called." },
      { name: "provider", type: "string", required: true, description: "Which tool: claude_code, claude_desktop, codex or cursor." },
      { name: "project", type: "string", description: "A project slug; with Claude Code and a local repo, the worker launches the session." },
    ],
    summary: "Create an agent session",
    humanOnly: true,
    why: NOT_FOR_AGENTS_YET,
  },
  signedIn,
  async (req, _params, caller) => {
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
);

// PATCH /api/v1/agent-sessions/:id  { name? | status:'ended' } — rename an
// agent session or end it (kept as history, not deleted).
export const updateSessionEndpoint = agents.define(
  {
    id: "agents_updateSession",
    method: "PATCH",
    path: "/agent-sessions/:id",
    scope: "write",
    params: [
      { name: "name", type: "string", description: "A new name for the session." },
      { name: "status", type: "string", description: "`ended`: end the session (kept as history)." },
    ],
    summary: "Rename an agent session, or end it",
    humanOnly: true,
    why: NOT_FOR_AGENTS_YET,
  },
  signedIn,
  async (req, { id }, caller) => {
    let body: { name?: string; status?: string } = {};
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "Invalid JSON" }, { status: 400 });
    }

    if (body.status === "ended") {
      await endAgentSession(caller.ownerId, id);
      return Response.json({ ok: true });
    }
    if (typeof body.name === "string" && body.name.trim()) {
      const session = await renameAgentSession(caller.ownerId, id, body.name.trim());
      if (!session) return Response.json({ error: "Not found" }, { status: 404 });
      return Response.json({ session });
    }
    return Response.json({ error: "Nothing to update" }, { status: 400 });
  }
);
