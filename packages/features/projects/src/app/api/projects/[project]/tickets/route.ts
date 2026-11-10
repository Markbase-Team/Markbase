import {
  createTicket,
  getProjectBySlug,
  listProjectTickets,
} from "@markbase/protocol/tickets";
import { CLAUDE_CODE_REQUIRED, featureEnabled } from "@markbase/node/features";

// GET /api/projects/:project/tickets — list tickets for one project (public
// requester view), scoped to the project in the URL.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ project: string }> }
) {
  const { project } = await params;
  if (!(await getProjectBySlug(project))) {
    return Response.json({ error: "Unknown project" }, { status: 404 });
  }
  return Response.json({ tickets: await listProjectTickets(project) });
}

// POST /api/projects/:project/tickets — a requester creates a ticket.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ project: string }> }
) {
  const { project } = await params;
  const projectRow = await getProjectBySlug(project);
  if (!projectRow) {
    return Response.json({ error: "Unknown project" }, { status: 404 });
  }

  let body: {
    title?: string;
    requester?: string;
    description?: string;
    images?: string[];
    base_branch?: string;
    properties?: Record<string, string>;
    cc_seed_session_id?: string;
    agent_session_id?: string;
  } = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const {
    title,
    requester,
    description,
    images,
    base_branch,
    properties,
    cc_seed_session_id,
    agent_session_id,
  } = body;

  const errors: string[] = [];
  if (typeof title !== "string" || !title.trim()) errors.push("title is required");
  if (typeof requester !== "string" || !requester.trim())
    errors.push("requester is required");
  if (typeof description !== "string" || !description.trim())
    errors.push("description is required");

  if (errors.length) {
    return Response.json({ error: errors.join(", ") }, { status: 400 });
  }

  // Public intake: an anonymous requester may not assign work to an agent the
  // project owner has no way to run. Checked against the *owner*, not the caller.
  if (
    agent_session_id &&
    projectRow.owner_id &&
    !(await featureEnabled("ticketDispatch", projectRow.owner_id))
  ) {
    return Response.json({ error: CLAUDE_CODE_REQUIRED }, { status: 403 });
  }

  // Accept image URLs (uploaded to Supabase Storage by the client).
  const imageUrls = Array.isArray(images)
    ? images.filter(
        (u): u is string => typeof u === "string" && /^https?:\/\//.test(u)
      )
    : [];

  const ticket = await createTicket({
    project,
    title: (title as string).trim(),
    requester: (requester as string).trim(),
    description: (description as string).trim(),
    // Both the public intake and the workspace "New ticket" modal post here.
    // Default to the user; naming an agent session assigns it to that agent.
    ownerKind: agent_session_id ? "agent" : "user",
    images: imageUrls,
    base_branch:
      typeof base_branch === "string" && base_branch.trim()
        ? base_branch.trim()
        : null,
    properties:
      properties && typeof properties === "object" ? properties : undefined,
    cc_seed_session_id:
      typeof cc_seed_session_id === "string" && cc_seed_session_id.trim()
        ? cc_seed_session_id.trim()
        : null,
    agentSessionId:
      typeof agent_session_id === "string" && agent_session_id.trim()
        ? agent_session_id.trim()
        : null,
  });

  return Response.json({ ticket }, { status: 201 });
}
